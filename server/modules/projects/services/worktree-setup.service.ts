import { readFile } from 'node:fs/promises';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

/**
 * Runs a repository's own setup command in a freshly created worktree.
 *
 * `git worktree add` checks out tracked files only, so a new copy has no
 * dependencies; an agent that builds or tests in it fails in ways that look like
 * code bugs. The command comes from `.clide/setup.json` in the new checkout:
 *
 *   { "command": "scripts/setup-worktree.sh ." }
 *
 * Setups run one at a time: each is an `npm ci`-sized job on a 4 GB machine.
 * Jobs live in memory and are polled, so a client that drops its connection
 * picks the job back up; a server restart loses them.
 */

export const SETUP_CONFIG_PATH = path.join('.clide', 'setup.json');

/** Tail kept per job; setup output is a progress log, not an archive. */
const OUTPUT_LIMIT = 32 * 1024;
/** Finished jobs kept for polling and Retry. */
const FINISHED_JOB_LIMIT = 20;

export type WorktreeSetupStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type WorktreeSetupView = {
  worktreePath: string;
  command: string;
  status: WorktreeSetupStatus;
  output: string;
  exitCode: number | null;
  /** Measured on the server, so a phone's clock cannot skew the timer. */
  elapsedMs: number;
  /** Jobs ahead of this one; 0 once it runs. */
  queuePosition: number;
};

type SetupProcess = {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'close', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

export type WorktreeSetupDependencies = {
  readConfig: (worktreePath: string) => Promise<string | null>;
  spawnSetup: (command: string, worktreePath: string) => SetupProcess;
  now: () => number;
  log: (line: string) => void;
};

type SetupJob = {
  worktreePath: string;
  command: string;
  status: WorktreeSetupStatus;
  output: string;
  exitCode: number | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

// Colour codes from the command's own output; the panel renders plain text.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

async function readSetupCommand(worktreePath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(worktreePath, SETUP_CONFIG_PATH), 'utf8');
  } catch {
    return null;
  }

  // A malformed file is the repository's mistake; surface it as a failed setup
  // rather than silently skipping one the repository asked for.
  try {
    const parsed = JSON.parse(raw) as { command?: unknown };
    const command = typeof parsed.command === 'string' ? parsed.command.trim() : '';
    return command || `false # ${SETUP_CONFIG_PATH} has no "command"`;
  } catch {
    return `false # ${SETUP_CONFIG_PATH} is not valid JSON`;
  }
}

function spawnSetupProcess(command: string, worktreePath: string): SetupProcess {
  const env = { ...process.env };
  // `npm ci` under NODE_ENV=production skips devDependencies, leaving a copy
  // that cannot build.
  delete env.NODE_ENV;
  return crossSpawn('/bin/sh', ['-c', command], { cwd: worktreePath, env, shell: false });
}

const defaultDependencies: WorktreeSetupDependencies = {
  readConfig: readSetupCommand,
  spawnSetup: spawnSetupProcess,
  now: () => Date.now(),
  log: (line) => console.log(line),
};

export function createWorktreeSetupQueue(dependencies: WorktreeSetupDependencies = defaultDependencies) {
  const jobs = new Map<string, SetupJob>();
  const pending: SetupJob[] = [];
  let running: SetupJob | null = null;

  const toView = (job: SetupJob): WorktreeSetupView => {
    const end = job.finishedAt ?? dependencies.now();
    return {
      worktreePath: job.worktreePath,
      command: job.command,
      status: job.status,
      output: job.output,
      exitCode: job.exitCode,
      elapsedMs: job.startedAt === null ? 0 : end - job.startedAt,
      queuePosition: job.status === 'queued' ? pending.indexOf(job) + (running ? 1 : 0) : 0,
    };
  };

  const append = (job: SetupJob, text: string) => {
    job.output = (job.output + text.replace(ANSI_PATTERN, '')).slice(-OUTPUT_LIMIT);
  };

  const pruneFinished = () => {
    const finished = [...jobs.values()].filter((job) => job.finishedAt !== null);
    finished
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .slice(0, Math.max(0, finished.length - FINISHED_JOB_LIMIT))
      .forEach((job) => jobs.delete(job.worktreePath));
  };

  const finish = (job: SetupJob, exitCode: number | null) => {
    if (job.finishedAt !== null) {
      return;
    }
    job.exitCode = exitCode;
    job.status = exitCode === 0 ? 'succeeded' : 'failed';
    job.finishedAt = dependencies.now();
    dependencies.log(
      `[worktree-setup] ${job.status} copy=${job.worktreePath} ms=${job.finishedAt - (job.startedAt ?? job.queuedAt)}`
      + ` exit=${exitCode ?? 'none'} waited_ms=${(job.startedAt ?? job.queuedAt) - job.queuedAt}`,
    );
    running = null;
    pruneFinished();
    startNext();
  };

  const startNext = () => {
    if (running) {
      return;
    }
    const job = pending.shift();
    if (!job) {
      return;
    }

    running = job;
    job.status = 'running';
    job.startedAt = dependencies.now();

    let child: SetupProcess;
    try {
      child = dependencies.spawnSetup(job.command, job.worktreePath);
    } catch (error) {
      append(job, `${error instanceof Error ? error.message : String(error)}\n`);
      finish(job, null);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => append(job, chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => append(job, chunk.toString()));
    child.on('error', (error) => {
      append(job, `${error.message}\n`);
      finish(job, null);
    });
    child.on('close', (code) => finish(job, code));
  };

  const enqueue = (worktreePath: string, command: string): WorktreeSetupView => {
    const job: SetupJob = {
      worktreePath,
      command,
      status: 'queued',
      output: '',
      exitCode: null,
      queuedAt: dependencies.now(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(worktreePath, job);
    pending.push(job);
    startNext();
    return toView(job);
  };

  return {
    /** Queues the worktree's setup; null when the repository declares none. */
    async start(worktreePath: string): Promise<WorktreeSetupView | null> {
      const existing = jobs.get(worktreePath);
      if (existing && existing.finishedAt === null) {
        return toView(existing);
      }
      const command = await dependencies.readConfig(worktreePath);
      return command ? enqueue(worktreePath, command) : null;
    },

    get(worktreePath: string): WorktreeSetupView | null {
      const job = jobs.get(worktreePath);
      return job ? toView(job) : null;
    },

    /** Re-runs a failed setup, re-reading the command in case it was fixed. */
    async retry(worktreePath: string): Promise<WorktreeSetupView | null> {
      const job = jobs.get(worktreePath);
      if (!job || job.status !== 'failed') {
        return job ? toView(job) : null;
      }
      const command = (await dependencies.readConfig(worktreePath)) ?? job.command;
      return enqueue(worktreePath, command);
    },
  };
}

export const worktreeSetupQueue = createWorktreeSetupQueue();
