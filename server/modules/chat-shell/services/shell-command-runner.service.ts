import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { buildUserShellEnv, resolveUserShell, stripAnsiFormatting } from '@/shared/utils.js';

/** Characters of output the agent and the card get inline; Claude Code's `bashOutputMaxChars` default (CLI 2.1.293). */
export const SHELL_INLINE_OUTPUT_LIMIT = 30_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 2_000;
const PROGRESS_INTERVAL_MS = 300;
/** The running card shows the end of the output, so a snapshot carries only this much. */
const PROGRESS_TAIL_CHARS = 4_000;
const SPILL_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const SPILL_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type ShellRunState = 'done' | 'failed' | 'stopped' | 'timed_out';

export type ShellRunResult = {
  /** stdout and stderr interleaved as they arrived, for the card. */
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  state: ShellRunState;
  durationMs: number;
  truncated: boolean;
  fullOutputPath?: string;
};

export type ShellRunOptions = {
  command: string;
  cwd: string;
  signal: AbortSignal;
  /** Names the spill file when output passes the inline limit. */
  outputName: string;
  outputDir?: string;
  timeoutMs?: number;
  inlineLimit?: number;
  /** Throttled while it runs, with the end of the output so far. */
  onProgress?: (tail: string) => void;
};

export type ShellRunHandle = {
  result: Promise<ShellRunResult>;
  /** The output so far, readable synchronously when an abort lands. */
  snapshot(): { output: string; durationMs: number };
};

/** Process groups still running, killed if the server exits under them. */
const liveGroups = new Set<ChildProcess>();
let exitHookInstalled = false;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of liveGroups) killGroup(child, 'SIGKILL');
  });
}

/** A progress bar's `\r` rewrites its line; keep what the line ended as. */
function collapseCarriageReturns(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n');
}

const clean = (text: string) => collapseCarriageReturns(stripAnsiFormatting(text));

/** Keeps the first `limit` characters of a stream and counts the rest. */
class CappedText {
  text = '';
  overflowed = false;
  constructor(private readonly limit: number) {}
  append(chunk: string): void {
    if (this.overflowed) return;
    const room = this.limit - this.text.length;
    if (chunk.length <= room) {
      this.text += chunk;
      return;
    }
    this.text += chunk.slice(0, Math.max(room, 0));
    this.overflowed = true;
  }
}

function removeOldSpills(dir: string): void {
  try {
    const cutoff = Date.now() - SPILL_RETENTION_MS;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    // Housekeeping only.
  }
}

/**
 * Runs one `!` command from the chat composer in the user's own shell.
 *
 * The command gets no stdin, so anything interactive fails fast instead of
 * hanging, and runs as its own process group, so a stop or the time limit
 * kills its children too. Output past the inline limit goes to a file whose
 * path the result names, as Claude Code does for its own bash mode.
 *
 * Used by the chat websocket's `chat.shell` handler.
 */
export function startShellCommand(options: ShellRunOptions): ShellRunHandle {
  const inlineLimit = options.inlineLimit ?? SHELL_INLINE_OUTPUT_LIMIT;
  const outputDir = options.outputDir ?? path.join(os.homedir(), '.cloudcli', 'shell-output');
  const startedAt = Date.now();
  const combined = new CappedText(inlineLimit);
  const stdout = new CappedText(inlineLimit);
  const stderr = new CappedText(inlineLimit);
  let spill: { path: string; stream: fs.WriteStream; bytes: number } | null = null;
  let tail = '';
  let tailChanged = false;

  const writeSpill = (chunk: string) => {
    if (!spill || spill.bytes >= SPILL_FILE_LIMIT_BYTES) return;
    spill.bytes += Buffer.byteLength(chunk);
    spill.stream.write(stripAnsiFormatting(chunk));
  };

  const onChunk = (chunk: string, target: CappedText) => {
    if (!chunk) return;
    target.append(chunk);
    const wasOverflowed = combined.overflowed;
    const keptBefore = combined.text.length;
    combined.append(chunk);
    if (combined.overflowed && !wasOverflowed) {
      try {
        fs.mkdirSync(outputDir, { recursive: true });
        removeOldSpills(outputDir);
        const file = path.join(outputDir, `${options.outputName}.log`);
        spill = { path: file, stream: fs.createWriteStream(file), bytes: 0 };
        writeSpill(combined.text);
        writeSpill(chunk.slice(combined.text.length - keptBefore));
      } catch {
        spill = null;
      }
    } else if (combined.overflowed) {
      writeSpill(chunk);
    }
    tail = (tail + chunk).slice(-PROGRESS_TAIL_CHARS * 2);
    tailChanged = true;
  };

  const result = new Promise<ShellRunResult>((resolve) => {
    const shell = resolveUserShell();
    const env = buildUserShellEnv(shell, options.cwd);
    // Pipes, not a terminal: ask tools for plain output.
    env.TERM = 'dumb';
    delete env.COLORTERM;
    env.TERM_PROGRAM = 'clide-shell';

    let finished = false;
    let stoppedBy: 'stopped' | 'timed_out' | null = null;
    let progressTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    let child: ChildProcess;
    try {
      child = spawn(shell, ['-c', options.command], {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolve({
        output: String(error instanceof Error ? error.message : error),
        stdout: '',
        stderr: String(error instanceof Error ? error.message : error),
        exitCode: null,
        state: 'failed',
        durationMs: Date.now() - startedAt,
        truncated: false,
      });
      return;
    }
    liveGroups.add(child);
    installExitHook();

    const stop = (reason: 'stopped' | 'timed_out') => {
      if (finished || stoppedBy) return;
      stoppedBy = reason;
      killGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS);
      killTimer.unref?.();
    };
    const onAbort = () => stop('stopped');
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });

    timeoutTimer = setTimeout(() => stop('timed_out'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeoutTimer.unref?.();

    if (options.onProgress) {
      progressTimer = setInterval(() => {
        if (!tailChanged) return;
        tailChanged = false;
        options.onProgress?.(clean(tail).slice(-PROGRESS_TAIL_CHARS));
      }, PROGRESS_INTERVAL_MS);
      progressTimer.unref?.();
    }

    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    child.stdout?.on('data', (data: Buffer) => onChunk(outDecoder.write(data), stdout));
    child.stderr?.on('data', (data: Buffer) => onChunk(errDecoder.write(data), stderr));

    const finish = (exitCode: number | null, spawnError?: Error) => {
      if (finished) return;
      finished = true;
      liveGroups.delete(child);
      options.signal.removeEventListener('abort', onAbort);
      if (progressTimer) clearInterval(progressTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      onChunk(outDecoder.end(), stdout);
      onChunk(errDecoder.end(), stderr);
      if (spawnError) onChunk(spawnError.message, stderr);
      const openSpill = spill as { path: string; stream: fs.WriteStream } | null;
      const state: ShellRunState = stoppedBy ?? (exitCode === 0 ? 'done' : 'failed');
      const settle = () => resolve({
        output: clean(combined.text),
        stdout: clean(stdout.text),
        stderr: clean(stderr.text),
        exitCode,
        state,
        durationMs: Date.now() - startedAt,
        truncated: combined.overflowed,
        ...(openSpill ? { fullOutputPath: openSpill.path } : {}),
      });
      // The agent may read the file the moment it is told about it.
      if (openSpill) openSpill.stream.end(settle);
      else settle();
    };

    child.once('error', (error) => finish(null, error));
    child.once('close', (code, signal) => finish(code ?? (signal ? null : 0)));
  });

  return {
    result,
    snapshot: () => ({ output: clean(combined.text), durationMs: Date.now() - startedAt }),
  };
}
