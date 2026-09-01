import path from 'node:path';

import {
  clearRepositoryLocationCache,
  defaultGitRunner,
  forgetCheckoutLocation,
  resolveRepositoryLocation,
  type GitRunnerDependencies,
  type RepositoryLocation,
} from '@/shared/git-checkout.js';

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

type RepositoryIdentityDependencies = GitRunnerDependencies;

const NO_IDENTITY: CheckoutIdentity = {
  repositoryId: null,
  branch: null,
  detachedHead: null,
};

/**
 * Reads one project directory's repository identity and current branch, so the
 * sidebar can group checkouts together. Never throws: any git or filesystem
 * failure is reported as "no identity", because an unreadable directory must
 * degrade to an ungrouped project rather than break the whole list.
 */
export async function readCheckoutIdentity(
  projectPath: string,
  dependencies: RepositoryIdentityDependencies = defaultGitRunner,
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
      forgetCheckoutLocation(projectPath);
      return NO_IDENTITY;
    }
    detachedHead = head.stdout.trim() || null;
  }

  const location = await resolveRepositoryLocation(projectPath, dependencies);
  if (!location) {
    forgetCheckoutLocation(projectPath);
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

export { clearRepositoryLocationCache };
