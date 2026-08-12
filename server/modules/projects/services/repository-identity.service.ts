import path from 'node:path';

import crossSpawn from 'cross-spawn';

/**
 * Git-derived identity of one project directory, per ADR 0016.
 *
 * `repositoryId` is the join key that lets several project rows be recognised as
 * checkouts of one repository. Derived at read time rather than stored, so no
 * schema migration and no session rebinding.
 */
export type CheckoutIdentity = {
  /**
   * Absolute path of the repository's shared git directory, which every checkout
   * resolves to identically. Null when the project is not a git repository, is
   * not the *root* of one, or no longer exists.
   */
  repositoryId: string | null;
  /** Checked-out branch, or `null` when HEAD is detached or there is no repository. */
  branch: string | null;
  /**
   * Short commit SHA, populated only when HEAD is detached. Detached HEAD is
   * reported as its own state, never as a branch called `HEAD` — the existing
   * Git panel gets that wrong (ADR 0016) and new surfaces must not repeat it.
   */
  detachedHead: string | null;
};

type GitInvocation = {
  stdout: string;
  ok: boolean;
};

type RepositoryIdentityDependencies = {
  runGit: (workingDirectory: string, args: string[]) => Promise<GitInvocation>;
};

/** Where a checkout sits: its repository's shared git dir, and its own root. */
type RepositoryLocation = {
  commonDir: string;
  topLevel: string;
};

const NO_IDENTITY: CheckoutIdentity = {
  repositoryId: null,
  branch: null,
  detachedHead: null,
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

const defaultDependencies: RepositoryIdentityDependencies = {
  runGit: runGitProcess,
};

/**
 * Resolves the repository a checkout belongs to.
 *
 * `--path-format=absolute` is not optional. Plain `--git-common-dir` returns a
 * *relative* `.git` for a main checkout but an *absolute* path for a linked
 * worktree, so its raw output as a join key fails to group a main checkout with
 * its own worktrees — the inverse of what ADR 0016 wants.
 */
async function resolveRepositoryLocation(
  projectPath: string,
  dependencies: RepositoryIdentityDependencies,
): Promise<RepositoryLocation | null> {
  const cached = repositoryLocationCache.get(projectPath);
  if (cached) {
    return cached;
  }

  const revParse = await dependencies.runGit(projectPath, [
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
  repositoryLocationCache.set(projectPath, location);
  return location;
}

/**
 * Reads one project directory's repository identity and current branch, so the
 * sidebar can group checkouts together. Never throws: any git or filesystem
 * failure is reported as "no identity", because an unreadable directory must
 * degrade to an ungrouped project rather than break the whole list.
 */
export async function readCheckoutIdentity(
  projectPath: string,
  dependencies: RepositoryIdentityDependencies = defaultDependencies,
): Promise<CheckoutIdentity> {
  // Every path below proves liveness with an *uncached* git call before the
  // memoised location is consulted. Retiring a worktree leaves its project row
  // behind, so a stale cache hit for a deleted directory is the normal case.
  const symbolicRef = await dependencies.runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = symbolicRef.stdout.trim();

  let detachedHead: string | null = null;

  if (!symbolicRef.ok && !branch) {
    // git exits non-zero with no output both when HEAD is detached and when this
    // is not a repository. Reading the commit tells them apart. A repository with
    // no commits never reaches here — `symbolic-ref` resolves its unborn branch.
    const head = await dependencies.runGit(projectPath, ['rev-parse', '--short', 'HEAD']);
    if (!head.ok) {
      repositoryLocationCache.delete(projectPath);
      return NO_IDENTITY;
    }
    detachedHead = head.stdout.trim() || null;
  }

  const location = await resolveRepositoryLocation(projectPath, dependencies);
  if (!location) {
    repositoryLocationCache.delete(projectPath);
    return NO_IDENTITY;
  }

  return {
    repositoryId: isCheckoutRoot(projectPath, location) ? location.commonDir : null,
    branch: branch || null,
    detachedHead,
  };
}

/**
 * Grouping applies only to a repository's checkout roots. A project registered
 * on a *subdirectory* (say `<repo>/docs`) resolves to the same common dir, and
 * grouping it would absorb an ordinary folder project into the checkout list.
 */
function isCheckoutRoot(projectPath: string, location: RepositoryLocation): boolean {
  return path.resolve(projectPath) === location.topLevel;
}

/** Test-only: drops memoised locations so each case starts from a known state. */
export function clearRepositoryLocationCache(): void {
  repositoryLocationCache.clear();
}
