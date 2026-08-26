import assert from 'node:assert/strict';
import test, { beforeEach, describe } from 'node:test';

import { clearRepositoryLocationCache, readCheckoutIdentity } from '@/modules/projects/services/repository-identity.service.js';
import { discoverUnregisteredCheckouts, listRepositoryWorktrees, parseWorktreeListPorcelain } from '@/modules/projects/services/worktree-inventory.service.js';
import {
  assertValidBaseRef,
  assertValidBranchName,
  createRepositoryWorktree,
  deriveWorktreePath,
} from '@/modules/projects/services/worktree.service.js';

describe('worktree.service', () => {
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
});

describe('worktree-inventory.service', () => {
  const MAIN_CHECKOUT = '/home/user/Projects/cloudcli';

  const PORCELAIN = [
    `worktree ${MAIN_CHECKOUT}`,
    'HEAD da397a73537a315bc479cd7a2c81225bbc41c7e2',
    'branch refs/heads/main',
    '',
    `worktree ${MAIN_CHECKOUT}-wt-landing-page`,
    'HEAD 236ea5d914f215a8db6f157a7e7b9647bb775482',
    'branch refs/heads/feature/landing-page',
    '',
    `worktree ${MAIN_CHECKOUT}-wt-detached`,
    'HEAD c4963912fc2d24a5111c1604449d8811c83b6a49',
    'detached',
    '',
    `worktree ${MAIN_CHECKOUT}-wt-gone`,
    'HEAD 3979146532f6016e44b399a0b2ea643230fb592d',
    'branch refs/heads/gone',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n');

  /** Replays canned porcelain for `worktree list` and records what git was asked. */
  function stubGit(overrides: { listFails?: boolean; output?: string } = {}) {
    const calls: Array<{ cwd: string; args: string[] }> = [];

    const runGit = async (cwd: string, args: string[]) => {
      calls.push({ cwd, args });
      return overrides.listFails
        ? { stdout: '', stderr: 'not a git repository', ok: false }
        : { stdout: overrides.output ?? PORCELAIN, stderr: '', ok: true };
    };

    return { calls, runGit };
  }

  const alwaysExists = async () => true;

  test('porcelain parsing keeps branch, detached, and prunable apart', () => {
    const entries = parseWorktreeListPorcelain(PORCELAIN);

    assert.equal(entries.length, 4);
    assert.equal(entries[0].path, MAIN_CHECKOUT);
    // The full ref is what git prints; the sidebar wants the short name.
    assert.equal(entries[1].branch, 'feature/landing-page');
    assert.equal(entries[2].branch, null);
    assert.equal(entries[2].isDetached, true);
    assert.equal(entries[3].isPrunable, true);
  });

  test('a locked worktree is still a real checkout', () => {
    const entries = parseWorktreeListPorcelain(
      [`worktree ${MAIN_CHECKOUT}-wt-locked`, 'HEAD abc123', 'branch refs/heads/locked', 'locked'].join('\n'),
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].isLocked, true);
    assert.equal(entries[0].isPrunable, false);
  });

  test('an unreadable repository contributes nothing rather than throwing', async () => {
    const { runGit } = stubGit({ listFails: true });

    const entries = await listRepositoryWorktrees(MAIN_CHECKOUT, { runGit, pathExists: alwaysExists });

    assert.deepEqual(entries, []);
  });

  test('discovery returns only worktrees with no project row', async () => {
    const { runGit, calls } = stubGit();
    const registered = new Set([MAIN_CHECKOUT, `${MAIN_CHECKOUT}-wt-landing-page`]);

    const discovered = await discoverUnregisteredCheckouts(
      {
        repositoryProbePaths: [MAIN_CHECKOUT],
        isRegistered: (checkoutPath) => registered.has(checkoutPath),
      },
      { runGit, pathExists: alwaysExists },
    );

    assert.deepEqual(
      discovered.map((entry) => entry.path),
      [`${MAIN_CHECKOUT}-wt-detached`],
    );
    // The prunable entry is excluded without ever reaching the filesystem check.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['worktree', 'list', '--porcelain']);
  });

  test('an archived checkout stays hidden, because archiving is deliberate', async () => {
    const { runGit } = stubGit();
    // `getProjectPath` ignores `isArchived`, so an archived row reads as registered.
    const rowsIncludingArchived = new Set([
      MAIN_CHECKOUT,
      `${MAIN_CHECKOUT}-wt-landing-page`,
      `${MAIN_CHECKOUT}-wt-detached`,
    ]);

    const discovered = await discoverUnregisteredCheckouts(
      {
        repositoryProbePaths: [MAIN_CHECKOUT],
        isRegistered: (checkoutPath) => rowsIncludingArchived.has(checkoutPath),
      },
      { runGit, pathExists: alwaysExists },
    );

    assert.deepEqual(discovered, []);
  });

  test('a worktree whose directory is gone is not offered', async () => {
    const { runGit } = stubGit();

    const discovered = await discoverUnregisteredCheckouts(
      {
        repositoryProbePaths: [MAIN_CHECKOUT],
        isRegistered: () => false,
      },
      { runGit, pathExists: async (candidate) => !candidate.endsWith('-wt-detached') },
    );

    assert.deepEqual(
      discovered.map((entry) => entry.path),
      [MAIN_CHECKOUT, `${MAIN_CHECKOUT}-wt-landing-page`],
    );
  });

  test('two checkouts of one repository are probed once, not twice', async () => {
    const { runGit, calls } = stubGit();

    const discovered = await discoverUnregisteredCheckouts(
      {
        // Callers pass one probe per repository; a repeated worktree path must
        // still not produce a duplicate list entry.
        repositoryProbePaths: [MAIN_CHECKOUT, `${MAIN_CHECKOUT}-wt-landing-page`],
        isRegistered: () => false,
      },
      { runGit, pathExists: alwaysExists },
    );

    assert.equal(calls.length, 2);
    assert.deepEqual(
      discovered.map((entry) => entry.path),
      [MAIN_CHECKOUT, `${MAIN_CHECKOUT}-wt-landing-page`, `${MAIN_CHECKOUT}-wt-detached`],
    );
  });
});

describe('repository-identity.service', () => {
  type GitCall = { cwd: string; args: string[] };

  /**
   * Builds a fake git whose responses are keyed by the first two arguments, so a
   * case only has to describe the commands it cares about. Anything unlisted
   * fails the way real git does for a non-repository.
   */
  function fakeGit(responses: Record<string, { stdout?: string; ok?: boolean }>) {
    const calls: GitCall[] = [];

    const runGit = async (cwd: string, args: string[]) => {
      calls.push({ cwd, args });
      const key = args.slice(0, 2).join(' ');
      const response = responses[key];
      if (!response) {
        return { stdout: '', ok: false };
      }
      return { stdout: response.stdout ?? '', ok: response.ok ?? true };
    };

    return { runGit, calls };
  }

  const REV_PARSE_KEY = 'rev-parse --path-format=absolute';
  const SYMBOLIC_REF_KEY = 'symbolic-ref --quiet';
  const SHORT_HEAD_KEY = 'rev-parse --short';

  beforeEach(() => {
    clearRepositoryLocationCache();
  });

  test('a main checkout and its linked worktree share one repositoryId', async () => {
    // The regression this pins: plain `--git-common-dir` prints a *relative*
    // `.git` for the main checkout and an absolute path for the worktree. Any
    // implementation that drops `--path-format=absolute` produces two different
    // keys here and fails to group them.
    const commonDir = '/repos/app/.git';

    const main = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'main\n' },
      [REV_PARSE_KEY]: { stdout: `${commonDir}\n/repos/app\n` },
    });
    const worktree = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'feature/x\n' },
      [REV_PARSE_KEY]: { stdout: `${commonDir}\n/repos/app-wt-feature\n` },
    });

    const mainIdentity = await readCheckoutIdentity('/repos/app', main);
    const worktreeIdentity = await readCheckoutIdentity('/repos/app-wt-feature', worktree);

    assert.equal(mainIdentity.repositoryId, worktreeIdentity.repositoryId);
    assert.equal(mainIdentity.repositoryId, commonDir);
    assert.equal(mainIdentity.branch, 'main');
    assert.equal(worktreeIdentity.branch, 'feature/x');
  });

  test('a directory that is not a repository has no identity', async () => {
    const git = fakeGit({});

    const identity = await readCheckoutIdentity('/home/user', git);

    assert.deepEqual(identity, { repositoryId: null, branch: null, detachedHead: null });
  });

  test('a subdirectory of a repository is not grouped as a checkout', async () => {
    // `<repo>/docs` resolves to the repository's common dir, but it is not a
    // checkout root and must stay an ordinary flat project.
    const git = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'main\n' },
      [REV_PARSE_KEY]: { stdout: '/repos/app/.git\n/repos/app\n' },
    });

    const identity = await readCheckoutIdentity('/repos/app/docs', git);

    assert.equal(identity.repositoryId, null);
    assert.equal(identity.branch, 'main');
  });

  test('detached HEAD reports a short SHA and no branch', async () => {
    // git exits non-zero with empty output from `symbolic-ref` when detached.
    const git = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: '', ok: false },
      [REV_PARSE_KEY]: { stdout: '/repos/app/.git\n/repos/app\n' },
      [SHORT_HEAD_KEY]: { stdout: '9a9d47b\n' },
    });

    const identity = await readCheckoutIdentity('/repos/app', git);

    assert.equal(identity.branch, null);
    assert.equal(identity.detachedHead, '9a9d47b');
    assert.equal(identity.repositoryId, '/repos/app/.git');
  });

  test('a resolved location is cached, but the branch is re-read every time', async () => {
    const git = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'main\n' },
      [REV_PARSE_KEY]: { stdout: '/repos/app/.git\n/repos/app\n' },
    });

    await readCheckoutIdentity('/repos/app', git);
    await readCheckoutIdentity('/repos/app', git);

    const revParseCalls = git.calls.filter((call) => call.args[1] === '--path-format=absolute');
    const branchCalls = git.calls.filter((call) => call.args[0] === 'symbolic-ref');

    assert.equal(revParseCalls.length, 1, 'the repository location should be resolved once');
    assert.equal(branchCalls.length, 2, 'a branch can change between reads and must not be cached');
  });

  test('a non-repository result is never cached, so git init is picked up', async () => {
    const before = fakeGit({});
    const identityBefore = await readCheckoutIdentity('/repos/fresh', before);
    assert.equal(identityBefore.repositoryId, null);

    const after = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'main\n' },
      [REV_PARSE_KEY]: { stdout: '/repos/fresh/.git\n/repos/fresh\n' },
    });
    const identityAfter = await readCheckoutIdentity('/repos/fresh', after);

    assert.equal(identityAfter.repositoryId, '/repos/fresh/.git');
  });

  test('a removed checkout drops its cached location instead of reporting stale identity', async () => {
    // Retiring a worktree leaves its project row behind, so this is the normal
    // path rather than an edge case.
    const present = fakeGit({
      [SYMBOLIC_REF_KEY]: { stdout: 'feature/x\n' },
      [REV_PARSE_KEY]: { stdout: '/repos/app/.git\n/repos/app-wt-gone\n' },
    });
    const cached = await readCheckoutIdentity('/repos/app-wt-gone', present);
    assert.equal(cached.repositoryId, '/repos/app/.git');

    const removed = fakeGit({});
    const identity = await readCheckoutIdentity('/repos/app-wt-gone', removed);

    assert.deepEqual(identity, { repositoryId: null, branch: null, detachedHead: null });
  });
});
