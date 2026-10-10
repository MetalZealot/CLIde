import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pty, { type IPty } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';
import { prioritizeUserNpmGlobalBin } from '@/shared/utils.js';

// Wire protocol, ported from upstream's cloudcli-plugin-terminal (protocol 2):
// binary frames carry raw PTY bytes both ways, text frames carry JSON control, so
// shell output that happens to be JSON can never be read as a command.
const PROTOCOL_VERSION = 2;

type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'ready'; sessionId: string; shell: string; cwd: string; resumed: boolean; reset: boolean; seq: number }
  | { type: 'exit'; sessionId: string; exitCode: number; signal?: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

type ClientMessage =
  | { type: 'init'; sessionId?: unknown; seq?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown }
  | { type: 'resize'; cols?: unknown; rows?: unknown }
  | { type: 'ping' }
  | { type: 'close' };

const DETACHED_GRACE_MS = 30 * 60 * 1000;
const REPLAY_BUFFER_BYTES = 256 * 1024;
const MAX_SESSIONS = 32;
const INIT_TIMEOUT_MS = 5000;
const MAX_COLS = 1000;
const MAX_ROWS = 500;
/** Another socket took this PTY; the client starts its own shell instead of fighting for it. */
const CLAIMED_ELSEWHERE_CODE = 4409;

/** Output tail kept per PTY, addressed by absolute byte offset so a reconnect replays only what it missed. */
class ReplayBuffer {
  private chunks: Buffer[] = [];
  private bytes = 0;
  seq = 0;

  push(chunk: Buffer): void {
    this.seq += chunk.length;
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > REPLAY_BUFFER_BYTES && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()!.length;
    }
  }

  get oldestSeq(): number {
    return this.seq - this.bytes;
  }

  all(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /** Bytes produced since `fromSeq`, or null once that far back has been dropped. */
  since(fromSeq: number): Buffer | null {
    if (fromSeq > this.seq || fromSeq < this.oldestSeq) {
      return null;
    }
    return this.all().subarray(fromSeq - this.oldestSeq);
  }
}

type TerminalSession = {
  id: string;
  ownerId: string;
  pty: IPty;
  ws: WebSocket | null;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  replay: ReplayBuffer;
  reapTimer: NodeJS.Timeout | null;
  exited: boolean;
};

type TerminalWebSocketDependencies = {
  spawnPty?: typeof pty.spawn;
};

const sessions = new Map<string, TerminalSession>();

function clampDimension(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(n, max)) : fallback;
}

/** The user's login shell from the passwd database; `$SHELL` is not forwarded under systemd. */
function resolveShell(): string {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
  try {
    const shell = os.userInfo().shell;
    if (shell && fs.existsSync(shell)) {
      return shell;
    }
  } catch {
    // No passwd entry.
  }
  return process.env.SHELL || '/bin/bash';
}

/** A missing or deleted project path falls back to home rather than failing the spawn. */
function resolveCwd(requested: unknown): string {
  for (const candidate of [requested, os.homedir()]) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue;
    }
    const resolved = path.resolve(candidate.trim());
    try {
      if (fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return process.cwd();
}

/** NODE_ENV is dropped: the server runs as production, which would make `npm install` here skip devDependencies. */
function buildShellEnv(shell: string, cwd: string): NodeJS.ProcessEnv {
  const prioritizedPath = prioritizeUserNpmGlobalBin(process.env);
  const env: NodeJS.ProcessEnv = { ...process.env, [prioritizedPath.key]: prioritizedPath.value };
  delete env.NODE_ENV;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'clide-terminal';
  env.PWD = cwd;
  if (os.platform() !== 'win32') {
    env.SHELL = shell;
    if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) {
      env.LANG = 'C.UTF-8';
    }
  }
  return env;
}

function sendControl(ws: WebSocket | null, message: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket died mid-send.
    }
  }
}

function sendData(ws: WebSocket | null, chunk: Buffer, done: () => void): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    done();
    return;
  }
  try {
    ws.send(chunk, { binary: true }, () => done());
  } catch {
    done();
  }
}

function killSession(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  sessions.delete(id);
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
  }
  try {
    session.pty.kill();
  } catch {
    // Already gone.
  }
  console.log(`[terminal] closed ${id} (${sessions.size} open)`);
}

function detachSession(session: TerminalSession): void {
  session.ws = null;
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
  }
  session.reapTimer = setTimeout(() => killSession(session.id), DETACHED_GRACE_MS);
  session.reapTimer.unref?.();
  // Nothing applies backpressure while detached; the replay buffer caps memory.
  try {
    session.pty.resume();
  } catch {
    // Already gone.
  }
}

function attachSession(session: TerminalSession, ws: WebSocket): void {
  if (session.ws && session.ws !== ws) {
    try {
      session.ws.close(CLAIMED_ELSEWHERE_CODE, 'session claimed elsewhere');
    } catch {
      // Already closed.
    }
  }
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }
  session.ws = ws;
}

function createSession(
  options: { ownerId: string; shell: string; cwd: string; cols: number; rows: number },
  spawnPty: typeof pty.spawn,
): TerminalSession {
  const id = randomUUID();
  const ptyProcess = spawnPty(options.shell, [], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: buildShellEnv(options.shell, options.cwd),
    // Exactly 'utf8' turns on IUTF8, so backspacing over a multi-byte character leaves no mojibake.
    encoding: 'utf8',
  });

  const session: TerminalSession = {
    id,
    ownerId: options.ownerId,
    pty: ptyProcess,
    ws: null,
    shell: options.shell,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    replay: new ReplayBuffer(),
    reapTimer: null,
    exited: false,
  };

  ptyProcess.onData((text) => {
    if (!text) {
      return;
    }
    const chunk = Buffer.from(text, 'utf8');
    session.replay.push(chunk);
    if (!session.ws) {
      return;
    }
    // Paused until the socket drains, so a fast producer cannot outrun a slow phone.
    session.pty.pause();
    sendData(session.ws, chunk, () => {
      try {
        session.pty.resume();
      } catch {
        // Already gone.
      }
    });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    session.exited = true;
    sendControl(session.ws, { type: 'exit', sessionId: id, exitCode, signal });
    if (sessions.get(id) === session) {
      sessions.delete(id);
    }
    if (session.reapTimer) {
      clearTimeout(session.reapTimer);
    }
    console.log(`[terminal] ${id} exited with ${exitCode} (${sessions.size} open)`);
  });

  sessions.set(id, session);
  console.log(`[terminal] started ${id}: ${options.shell} in ${options.cwd} (${sessions.size} open)`);
  return session;
}

function parseClientMessage(raw: RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
      return parsed as ClientMessage;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/**
 * Used by this module's websocket gateway for the Terminal tab: a plain shell whose
 * PTY outlives its socket for a grace period and is re-attached by id, replaying
 * only the output the client missed.
 */
export function handleTerminalConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: TerminalWebSocketDependencies = {},
): void {
  const spawnPty = dependencies.spawnPty ?? pty.spawn;
  const ownerId = String(request.user?.id ?? request.user?.userId ?? '');
  let session: TerminalSession | null = null;
  let initialised = false;

  const fail = (message: string): void => {
    sendControl(ws, { type: 'error', message });
    try {
      ws.close(1011, 'terminal error');
    } catch {
      // Already closed.
    }
  };

  const start = (message: Extract<ClientMessage, { type: 'init' }> | null): void => {
    if (initialised) {
      return;
    }
    initialised = true;
    clearTimeout(initTimer);
    const cols = clampDimension(message?.cols, 80, MAX_COLS);
    const rows = clampDimension(message?.rows, 24, MAX_ROWS);

    const wanted = typeof message?.sessionId === 'string' ? sessions.get(message.sessionId) : undefined;
    if (wanted && !wanted.exited && wanted.ownerId === ownerId) {
      session = wanted;
      attachSession(session, ws);
      try {
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
      } catch {
        // Already gone.
      }
      const clientSeq = typeof message?.seq === 'number' ? message.seq : 0;
      const missed = session.replay.since(clientSeq);
      const reset = missed === null;
      const payload = missed ?? session.replay.all();
      // `seq` is the offset of the first replayed byte, so the client keeps counting from there.
      sendControl(ws, {
        type: 'ready',
        sessionId: session.id,
        shell: session.shell,
        cwd: session.cwd,
        resumed: true,
        reset,
        seq: reset ? session.replay.oldestSeq : clientSeq,
      });
      if (payload.length > 0) {
        sendData(ws, payload, () => undefined);
      }
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      fail(`Too many terminals open (limit ${MAX_SESSIONS}).`);
      return;
    }

    const shell = resolveShell();
    const cwd = resolveCwd(message?.cwd);
    try {
      session = createSession({ ownerId, shell, cwd, cols, rows }, spawnPty);
    } catch (error) {
      fail(`Failed to start ${shell}: ${(error as Error).message}`);
      return;
    }
    attachSession(session, ws);
    sendControl(ws, { type: 'ready', sessionId: session.id, shell, cwd, resumed: false, reset: false, seq: 0 });
  };

  // The client answers `hello` with `init`; one that never does gets a default shell rather than a dead socket.
  const initTimer = setTimeout(() => start(null), INIT_TIMEOUT_MS);
  initTimer.unref?.();
  sendControl(ws, { type: 'hello', protocol: PROTOCOL_VERSION });

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      if (session && !session.exited) {
        try {
          // Raw bytes, never re-decoded: mouse reports and pasted binary would not survive UTF-8.
          session.pty.write(Buffer.isBuffer(raw) ? raw : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(raw)]));
        } catch {
          // Already gone.
        }
      }
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      return;
    }
    if (message.type === 'init') {
      start(message);
    } else if (message.type === 'ping') {
      sendControl(ws, { type: 'pong' });
    } else if (message.type === 'close') {
      if (session) {
        killSession(session.id);
      }
    } else if (message.type === 'resize' && session && !session.exited) {
      const cols = clampDimension(message.cols, session.cols, MAX_COLS);
      const rows = clampDimension(message.rows, session.rows, MAX_ROWS);
      if (cols !== session.cols || rows !== session.rows) {
        session.cols = cols;
        session.rows = rows;
        try {
          session.pty.resize(cols, rows);
        } catch {
          // Already gone.
        }
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(initTimer);
    // A dropped connection must not take a running build with it; the PTY is reaped after the grace period.
    if (session && sessions.get(session.id) === session && session.ws === ws) {
      detachSession(session);
    }
  });

  ws.on('error', (error: Error) => {
    console.error('[terminal] socket error:', error.message);
  });
}
