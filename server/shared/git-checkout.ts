import path from 'node:path';

import crossSpawn from 'cross-spawn';

export type GitInvocation = {
  stdout: string;
  ok: boolean;
};

export type GitRunnerDependencies = {
  runGit: (workingDirectory: string, args: string[]) => Promise<GitInvocation>;
};

/** Where a checkout sits: its repository's shared git dir, and its own root. */
export type RepositoryLocation = {
  commonDir: string;
  topLevel: string;
};

// Only successful lookups are cached. A negative result must not be: a project
// can become a repository at any time via `POST /api/git/init`, and a cached
// "not a repository" would survive that indefinitely.
const repositoryLocationCache = new Map<string, RepositoryLocation>();

function runGitProcess(workingDirectory: string, args: string[]): Promise<GitInvocation> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd: workingDirectory, shell: false });

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // stderr is discarded: every failure here is an expected, non-actionable
    // "not a repository" or "no such directory".
    child.stderr?.resume();

    child.on('error', () => resolve({ stdout: '', ok: false }));
    child.on('close', (code) => resolve({ stdout, ok: code === 0 }));
  });
}

export const defaultGitRunner: GitRunnerDependencies = {
  runGit: runGitProcess,
};

/**
 * Resolves the repository a directory belongs to.
 *
 * `--path-format=absolute` is not optional. Plain `--git-common-dir` returns a
 * *relative* `.git` for a main checkout but an *absolute* path for a linked
 * worktree, so its raw output as a join key fails to group a main checkout with
 * its own worktrees — the inverse of what ADR 0016 wants.
 */
export async function resolveRepositoryLocation(
  directory: string,
  dependencies: GitRunnerDependencies = defaultGitRunner,
): Promise<RepositoryLocation | null> {
  const cached = repositoryLocationCache.get(directory);
  if (cached) {
    return cached;
  }

  const revParse = await dependencies.runGit(directory, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
    '--show-toplevel',
  ]);
  if (!revParse.ok) {
    return null;
  }

  const [commonDir, topLevel] = revParse.stdout.split('\n').map((line) => line.trim());
  if (!commonDir || !topLevel) {
    return null;
  }

  const location: RepositoryLocation = {
    commonDir: path.resolve(commonDir),
    topLevel: path.resolve(topLevel),
  };
  repositoryLocationCache.set(directory, location);
  return location;
}

/**
 * Root of the checkout containing `directory`, or null when it is not in a
 * repository. A directory *inside* a checkout resolves to the checkout, which
 * is what keeps a session that stepped into a subdirectory filed under the
 * checkout it is working in.
 */
export async function resolveCheckoutRoot(
  directory: string,
  dependencies: GitRunnerDependencies = defaultGitRunner,
): Promise<string | null> {
  const location = await resolveRepositoryLocation(directory, dependencies);
  return location?.topLevel ?? null;
}

/** Drops one memoised location, for a directory that has stopped being a checkout. */
export function forgetCheckoutLocation(directory: string): void {
  repositoryLocationCache.delete(directory);
}

/** Test-only: drops memoised locations so each case starts from a known state. */
export function clearRepositoryLocationCache(): void {
  repositoryLocationCache.clear();
}
