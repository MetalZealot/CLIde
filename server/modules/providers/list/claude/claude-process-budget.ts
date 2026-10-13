import { readFileSync } from 'node:fs';

/**
 * Memory budget for every `claude` CLIde spawns: chats, side questions, command
 * and model reads, commit messages. Sized from measurements (2026-10-05): an
 * idle `claude` holds ~122 MB private, ~170 MB mid-turn with tool children.
 */
const DEFAULT_FLOOR_MB = 300;
const DEFAULT_IDLE_TIMEOUT_MIN = 15;
const WAIT_POLL_MS = 2_000;
const WAIT_LIMIT_MS = 60_000;
/** Closing a process frees its memory over the next moment, not at once. */
const EVICT_SETTLE_MS = 500;

const readPositive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** A new `claude` waits while available memory is under this; `CLIDE_MEMORY_FLOOR_MB`. */
export const claudeMemoryFloorMb = (): number => readPositive(process.env.CLIDE_MEMORY_FLOOR_MB, DEFAULT_FLOOR_MB);

/** A process past its turn that nothing holds closes after this; `CLIDE_CLAUDE_IDLE_TIMEOUT_MIN`. */
export const claudeIdleTimeoutMs = (): number =>
  readPositive(process.env.CLIDE_CLAUDE_IDLE_TIMEOUT_MIN, DEFAULT_IDLE_TIMEOUT_MIN) * 60_000;

/** `MemAvailable` from /proc/meminfo; null where the host has none. */
export function readMemAvailableMb(meminfo?: string): number | null {
  let text = meminfo;
  if (text === undefined) {
    try {
      text = readFileSync('/proc/meminfo', 'utf8');
    } catch {
      return null;
    }
  }
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(text);
  return match ? Math.floor(Number(match[1]) / 1024) : null;
}

let liveSpawns = 0;

/** Counts one `claude` for as long as it lives; call the returned function when it exits. */
export function trackClaudeSpawn(): () => void {
  liveSpawns += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    liveSpawns -= 1;
  };
}

export const countClaudeSpawns = (): number => liveSpawns;

/** The chat runtime's processes, as the budget sees them. */
export type ClaudeProcessSource = {
  /** Processes past their turn that nothing holds, any order; the oldest is closed first. */
  listIdle(): Array<{ sessionId: string; idleSince: number }>;
  closeIdle(sessionId: string): boolean;
  /** Sessions whose process is held for background work: never closed to make room. */
  countPinned(): number;
};

const noProcesses: ClaudeProcessSource = { listIdle: () => [], closeIdle: () => false, countPinned: () => 0 };
let processSource = noProcesses;

/** Registered by the chat runtime, so short-lived spawns elsewhere can make room too. */
export function setClaudeProcessSource(source: ClaudeProcessSource | null): void {
  processSource = source ?? noProcesses;
}

export type ClaudeMemoryWaitInput = {
  source?: ClaudeProcessSource;
  /** Told once, when the open starts waiting, why it waits. */
  onWait?(reason: string): void;
  signal?: AbortSignal | null;
  readMem?: () => number | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms).unref?.();
});

/**
 * Resolves once a new `claude` fits above the memory floor. Closes idle
 * processes oldest first; when only pinned or working ones remain, waits and
 * says why, then gives up with that reason after a minute.
 */
export async function waitForClaudeMemory(input: ClaudeMemoryWaitInput = {}): Promise<void> {
  const source = input.source ?? processSource;
  const readMem = input.readMem ?? (() => readMemAvailableMb());
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const floor = claudeMemoryFloorMb();
  const startedAt = now();
  let told = false;

  for (;;) {
    const available = readMem();
    if (available === null || available >= floor) return;
    if (input.signal?.aborted) throw new Error('Cancelled while waiting for memory.');

    const oldest = source.listIdle().sort((left, right) => left.idleSince - right.idleSince)[0];
    if (oldest && source.closeIdle(oldest.sessionId)) {
      console.log(`[claude-budget] closed idle session=${oldest.sessionId} available_mb=${available} floor_mb=${floor}`);
      await sleep(EVICT_SETTLE_MS);
      continue;
    }

    const pinned = source.countPinned();
    const reason = `Waiting for memory: ${available} MB free, ${floor} MB needed`
      + (pinned > 0 ? `; ${pinned} chat${pinned === 1 ? ' is' : 's are'} holding background work.` : '.');
    if (!told) {
      told = true;
      console.log(`[claude-budget] waiting available_mb=${available} floor_mb=${floor} pinned=${pinned} live=${liveSpawns}`);
      input.onWait?.(reason);
    }
    if (now() - startedAt >= WAIT_LIMIT_MS) {
      throw new Error(`${reason} Stop some background work or close an app, then send again.`);
    }
    await sleep(WAIT_POLL_MS);
  }
}
