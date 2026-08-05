import path from 'node:path';

import crossSpawn from 'cross-spawn';

/**
 * Git-derived identity of one project directory, per ADR 0016.
 *
 * `repositoryId` is the join key that lets several project rows be recognised
 * as checkouts of one repository. It is intentionally derived at read time
 * rather than stored, so no schema migration and no session rebinding is
 * involved.
 */
export type CheckoutIdentity = {
  /**
   * Absolute path of the repository's shared git directory, which every
   * checkout of that repository resolves to identically. `null` when the
   * project is not a git repository, is not the *root* of one, or no longer
   * exists on disk.
   */
  repositoryId: string | null;
  /** Checked-out branch, or `null` when HEAD is detached or there is no repository. */
  branch: string | null;
  /**
   * Short commit SHA, populated only when HEAD is detached.
   *
   * Detached HEAD is reported as its own state rather than as a branch called
   * `HEAD` — the existing Git panel gets this wrong (see ADR 0016's Phase 0
   * list) and new surfaces must not repeat it.
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

// Only successful lookups are cached. A negative result must not be, because a
// project can become a repository at any time through `POST /api/git/init`, and
// a cached "not a repository" would survive that indefinitely.
const repositoryLocationCache = new Map<string, RepositoryLocation>();

function runGitProcess(workingDirectory: string, args: string[]): Promise<GitInvocation> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd: workingDirectory, shell: false });

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // stderr is deliberately discarded: every failure here is an expected,
    // non-actionable "not a repository" or "no such directory".
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
 * worktree, so using its raw output as a join key would fail to group a main
 * checkout with its own worktrees — the exact inverse of what ADR 0016 wants.
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
 * Reads one project directory's repository identity and current branch.
 *
 * Used by the project-listing service so the sidebar can group checkouts of one
 * repository together. Never throws: any git or filesystem failure is reported
 * as "no identity", because an unreadable directory must degrade to an ordinary
 * ungrouped project rather than break the whole project list.
 */
export async function readCheckoutIdentity(
  projectPath: string,
  dependencies: RepositoryIdentityDependencies = defaultDependencies,
): Promise<CheckoutIdentity> {
  // Every path below proves liveness with an *uncached* git call before the
  // memoised location is consulted. Retiring a worktree leaves its project row
  // behind, so a stale cache hit for a deleted directory is the normal failure
  // mode here rather than an edge case.
  const symbolicRef = await dependencies.runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = symbolicRef.stdout.trim();

  let detachedHead: string | null = null;

  if (!symbolicRef.ok && !branch) {
    // git exits non-zero with no output both when HEAD is detached and when
    // this is not a repository at all. Reading the commit tells them apart:
    // a detached checkout has one, a missing or non-repository directory does
    // not. A repository with no commits yet never reaches here, because
    // `symbolic-ref` still resolves its unborn branch.
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
 * Grouping applies only to a repository's checkout roots.
 *
 * A project registered on a *subdirectory* of a repository (say `<repo>/docs`)
 * resolves to that repository's common dir too, and grouping it would silently
 * absorb an ordinary folder project into the repository's checkout list.
 */
function isCheckoutRoot(projectPath: string, location: RepositoryLocation): boolean {
  return path.resolve(projectPath) === location.topLevel;
}

/** Test-only: drops memoised locations so each case starts from a known state. */
export function clearRepositoryLocationCache(): void {
  repositoryLocationCache.clear();
}
