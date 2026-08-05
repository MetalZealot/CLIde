import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearRepositoryLocationCache,
  readCheckoutIdentity,
} from '@/modules/projects/services/repository-identity.service.js';

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
