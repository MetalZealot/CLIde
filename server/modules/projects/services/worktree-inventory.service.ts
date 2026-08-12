import { access } from 'node:fs/promises';

import crossSpawn from 'cross-spawn';

import { normalizeProjectPath } from '@/shared/utils.js';

/**
 * Finding the worktrees of a repository CLIde has no project row for, so the
 * sidebar can show a checkout created outside the app.
 *
 * A project row is written in exactly two places — the in-app creation flow, and
 * the session synchronizer recording a transcript's `cwd`. A worktree created
 * from a shell satisfies neither, so nothing in the UI names it until someone
 * starts a session there. This service closes that gap by *reading* git, never
 * writing a row: discovery is derived at request time, as ADR 0016 treats
 * repository identity.
 */

export type WorktreePorcelainEntry = {
  path: string;
  headSha: string | null;
  branch: string | null;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
};

type GitInvocation = {
  stdout: string;
  stderr: string;
  ok: boolean;
};

export type WorktreeInventoryDependencies = {
  runGit: (workingDirectory: string, args: string[]) => Promise<GitInvocation>;
  pathExists: (candidatePath: string) => Promise<boolean>;
};

function runGitProcess(workingDirectory: string, args: string[]): Promise<GitInvocation> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd: workingDirectory, shell: false });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: Error) => resolve({ stdout: '', stderr: error.message, ok: false }));
    child.on('close', (code) => resolve({ stdout, stderr, ok: code === 0 }));
  });
}

async function directoryExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

const defaultDependencies: WorktreeInventoryDependencies = {
  runGit: runGitProcess,
  pathExists: directoryExists,
};

/**
 * Parses `git worktree list --porcelain`. Entries are separated by blank lines
 * and the first is always the main worktree.
 *
 * Harvested from upstream v1.37's rejected Worktrees module — the one part of
 * that feature worth keeping, since parsing git's stable output carries no
 * product opinion. Paths are normalized so they compare equal to the DB's stored
 * project paths.
 */
export function parseWorktreeListPorcelain(output: string): WorktreePorcelainEntry[] {
  const entries: WorktreePorcelainEntry[] = [];
  let current: WorktreePorcelainEntry | null = null;

  const flush = () => {
    if (current) {
      entries.push(current);
      current = null;
    }
  };

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith('worktree ')) {
      flush();
      current = {
        path: normalizeProjectPath(line.slice('worktree '.length)),
        headSha: null,
        branch: null,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('HEAD ')) {
      current.headSha = line.slice('HEAD '.length).trim() || null;
    } else if (line.startsWith('branch ')) {
      // Porcelain reports the full ref, e.g. "branch refs/heads/feature/x".
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim() || null;
    } else if (line === 'detached') {
      current.isDetached = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.isLocked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.isPrunable = true;
    }
  }

  flush();
  return entries;
}

/**
 * Every worktree of the repository containing `checkoutPath`. Never throws: this
 * runs inside the project-list request, where an unreadable directory must cost
 * no more than the discoveries it would have contributed — the same contract
 * `readCheckoutIdentity` keeps.
 */
export async function listRepositoryWorktrees(
  checkoutPath: string,
  dependencies: WorktreeInventoryDependencies = defaultDependencies,
): Promise<WorktreePorcelainEntry[]> {
  const listed = await dependencies.runGit(checkoutPath, ['worktree', 'list', '--porcelain']);
  if (!listed.ok) {
    return [];
  }

  return parseWorktreeListPorcelain(listed.stdout);
}

export type DiscoverCheckoutsInput = {
  /**
   * One registered checkout per repository — `git worktree list` reports the
   * whole repository from any of them, so asking twice only spends git calls.
   */
  repositoryProbePaths: string[];
  /** True when a path already has a project row, archived or not. */
  isRegistered: (checkoutPath: string) => boolean;
};

/**
 * Worktree paths that exist on disk with no project row.
 *
 * Archived rows count as registered: archiving is deliberate, and rediscovering
 * would put the user in an unwinnable loop.
 */
export async function discoverUnregisteredCheckouts(
  input: DiscoverCheckoutsInput,
  dependencies: WorktreeInventoryDependencies = defaultDependencies,
): Promise<WorktreePorcelainEntry[]> {
  const discovered = new Map<string, WorktreePorcelainEntry>();

  for (const probePath of input.repositoryProbePaths) {
    const entries = await listRepositoryWorktrees(probePath, dependencies);

    for (const entry of entries) {
      if (!entry.path || entry.isPrunable || discovered.has(entry.path)) {
        continue;
      }
      if (input.isRegistered(entry.path)) {
        continue;
      }
      // `prunable` is git's own answer to "is this directory still there", but it
      // depends on prune settings and git version, so the filesystem wins.
      if (!(await dependencies.pathExists(entry.path))) {
        continue;
      }

      discovered.set(entry.path, entry);
    }
  }

  return [...discovered.values()];
}
