import { readdirSync, readFileSync } from 'node:fs';

const OWNER_PID = 'CLIDE_OWNER_PID';
const OWNER_PORT = 'CLIDE_OWNER_PORT';

/** Every child this server spawns inherits these, so a later start can find what it left behind. */
export function markProcessOwnership(port: number): void {
  process.env[OWNER_PID] = String(process.pid);
  process.env[OWNER_PORT] = String(port);
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export type ProcessTable = {
  listPids(): number[];
  /** NUL-separated `KEY=value` pairs; null when unreadable (another user's, or gone). */
  readEnviron(pid: number): string | null;
  isAlive(pid: number): boolean;
  kill(pid: number): void;
};

const procTable: ProcessTable = {
  listPids: () => readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).map(Number),
  readEnviron: (pid) => {
    try {
      return readFileSync(`/proc/${pid}/environ`, 'latin1');
    } catch {
      return null;
    }
  },
  isAlive,
  kill: (pid) => process.kill(pid, 'SIGTERM'),
};

/**
 * Ends processes an earlier server on this port spawned and outlived: agent
 * CLIs and their background commands. Under the systemd units the cgroup kill
 * already does this; it matters for servers run by hand. Only processes marked
 * by this port whose owner is gone are touched, never the user's own.
 */
export function sweepOrphanedProcesses(port: number, table: ProcessTable = procTable): number[] {
  const swept: number[] = [];
  for (const pid of table.listPids()) {
    if (pid === process.pid) continue;
    const environ = table.readEnviron(pid);
    if (!environ) continue;
    const vars = new Map(environ.split('\0').map((pair) => {
      const at = pair.indexOf('=');
      return [pair.slice(0, at), pair.slice(at + 1)] as const;
    }));
    const ownerPid = Number(vars.get(OWNER_PID));
    if (vars.get(OWNER_PORT) !== String(port) || !Number.isInteger(ownerPid)) continue;
    if (ownerPid === process.pid || table.isAlive(ownerPid)) continue;
    try {
      table.kill(pid);
      swept.push(pid);
    } catch {
      // Exited between the scan and the kill.
    }
  }
  return swept;
}
