import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverUnregisteredCheckouts,
  listRepositoryWorktrees,
  parseWorktreeListPorcelain,
} from '@/modules/projects/services/worktree-inventory.service.js';

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
