import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertValidBaseRef,
  assertValidBranchName,
  createRepositoryWorktree,
  deriveWorktreePath,
} from '@/modules/projects/services/worktree.service.js';

const REPOSITORY_ROOT = '/home/user/Projects/cloudcli';

/** Records what git was asked to do, and replays canned output for rev-parse. */
function stubGit(overrides: { addFails?: string; pathRejection?: string } = {}) {
  const calls: Array<{ cwd: string; args: string[] }> = [];
  const validatedPaths: string[] = [];

  const runGit = async (cwd: string, args: string[]) => {
    calls.push({ cwd, args });

    if (args[0] === 'rev-parse') {
      return { stdout: `${REPOSITORY_ROOT}/.git\n${cwd}\n`, stderr: '', ok: true };
    }

    return overrides.addFails
      ? { stdout: '', stderr: overrides.addFails, ok: false }
      : { stdout: '', stderr: '', ok: true };
  };

  const validatePath = async (candidatePath: string) => {
    validatedPaths.push(candidatePath);
    return overrides.pathRejection
      ? { valid: false, error: overrides.pathRejection }
      : { valid: true };
  };

  return { calls, validatedPaths, dependencies: { runGit, validatePath } };
}

test('a new worktree lands beside the repository, not inside it', () => {
  assert.equal(
    deriveWorktreePath(REPOSITORY_ROOT, 'feat/repo-grouping'),
    '/home/user/Projects/cloudcli-wt-feat-repo-grouping',
  );
  // Nesting it under the repository would make the tree show up as untracked
  // files in the parent's own status.
  assert.equal(
    deriveWorktreePath(REPOSITORY_ROOT, 'main').startsWith(`${REPOSITORY_ROOT}/`),
    false,
  );
});

test('branch names git would reject are refused before anything is spawned', () => {
  for (const branch of ['', 'has space', 'trailing/', '-leading', 'a..b', 'ref@{0}', 'back\\slash']) {
    assert.throws(
      () => assertValidBranchName(branch),
      /Invalid branch name/,
      `"${branch}" is not a usable branch name`,
    );
  }

  assert.doesNotThrow(() => assertValidBranchName('feat/repository-grouped-checkouts'));
});

test('a base ref is a commit-ish, so the branch-name rules do not apply to it', () => {
  for (const baseRef of ['main^', 'HEAD~2', 'HEAD@{1}', 'origin/main', 'v1.37.0', 'a1b2c3d']) {
    assert.doesNotThrow(() => assertValidBaseRef(baseRef), `"${baseRef}" is a usable base`);
  }

  // Revision syntax is exactly what the branch-name rules exist to reject, which
  // is why applying them to a base ref was wrong.
  for (const revision of ['main^', 'HEAD~2', 'HEAD@{1}']) {
    assert.throws(() => assertValidBranchName(revision), /Invalid branch name/);
  }

  // A leading dash would be read as an option, and whitespace is never a ref.
  for (const baseRef of ['', '--force', '-b', 'has space', 'glob*']) {
    assert.throws(() => assertValidBaseRef(baseRef), /Invalid base ref/, `"${baseRef}" is not a usable base`);
  }
});

test('a destination outside the workspace root is refused before git runs', async () => {
  const git = stubGit({ pathRejection: 'Workspace path must be within the allowed workspace root: /home/user' });

  await assert.rejects(
    createRepositoryWorktree(
      { repositoryProjectPath: REPOSITORY_ROOT, branch: 'feat/next', worktreePath: '/tmp/elsewhere' },
      git.dependencies,
    ),
    /Invalid worktree path/,
  );

  // The point of preflighting: no tree is left on disk that CLIde then refuses
  // to register.
  assert.equal(git.calls.some(({ args }) => args[0] === 'worktree'), false);
  assert.deepEqual(git.validatedPaths, ['/tmp/elsewhere']);
});

test('the worktree is added from the main worktree, whichever one asked for it', async () => {
  const git = stubGit();

  const result = await createRepositoryWorktree(
    // Asked for by a *linked* worktree, which is the common case once a
    // repository row has several.
    { repositoryProjectPath: '/home/user/Projects/cloudcli-wt-tts', branch: 'feat/next' },
    git.dependencies,
  );

  const add = git.calls.find(({ args }) => args[0] === 'worktree');
  assert.deepEqual(add?.args, [
    'worktree',
    'add',
    '-b',
    'feat/next',
    '/home/user/Projects/cloudcli-wt-feat-next',
  ]);
  assert.equal(add?.cwd, REPOSITORY_ROOT, 'the shared git dir names the main worktree');
  assert.equal(result.worktreePath, '/home/user/Projects/cloudcli-wt-feat-next');
});

test('an explicit path and base ref are passed through', async () => {
  const git = stubGit();

  await createRepositoryWorktree(
    {
      repositoryProjectPath: REPOSITORY_ROOT,
      branch: 'hotfix',
      worktreePath: '/home/user/scratch/hotfix',
      baseRef: 'main',
    },
    git.dependencies,
  );

  const add = git.calls.find(({ args }) => args[0] === 'worktree');
  assert.deepEqual(add?.args.slice(-2), ['/home/user/scratch/hotfix', 'main']);
});

test("git's own refusal is what the user is told", async () => {
  const git = stubGit({ addFails: "fatal: 'feat/next' is already checked out at '/home/user/other'" });

  await assert.rejects(
    createRepositoryWorktree({ repositoryProjectPath: REPOSITORY_ROOT, branch: 'feat/next' }, git.dependencies),
    (error: Error & { details?: string }) => {
      assert.match(String(error.details), /already checked out/);
      return true;
    },
  );
});
