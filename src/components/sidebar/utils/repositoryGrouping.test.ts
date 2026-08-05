import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import { filterProjects, groupProjectsByRepository, isMainCheckout } from './utils';

const CLOUDCLI_REPO = '/home/user/Projects/cloudcli/.git';

const project = (overrides: Partial<Project> & { projectId: string; fullPath: string }): Project => ({
  displayName: overrides.projectId,
  repositoryId: null,
  branch: null,
  detachedHead: null,
  ...overrides,
});

const mainCheckout = project({
  projectId: 'p-main',
  displayName: 'cloudcli',
  fullPath: '/home/user/Projects/cloudcli',
  repositoryId: CLOUDCLI_REPO,
  branch: 'main',
});

const worktreeA = project({
  projectId: 'p-tts',
  displayName: 'cloudcli-wt-tts',
  fullPath: '/home/user/Projects/cloudcli-wt-tts',
  repositoryId: CLOUDCLI_REPO,
  branch: 'feature/tts-and-stt',
});

const worktreeB = project({
  projectId: 'p-codex',
  displayName: 'cloudcli-wt-codex',
  fullPath: '/home/user/Projects/cloudcli-wt-codex',
  repositoryId: CLOUDCLI_REPO,
  branch: 'test/codex',
});

const soloRepository = project({
  projectId: 'p-oney',
  displayName: 'oney-index',
  fullPath: '/home/user/Projects/oney-index',
  repositoryId: '/home/user/Projects/oney-index/.git',
  branch: 'master',
});

const plainFolder = project({
  projectId: 'p-home',
  displayName: 'home',
  fullPath: '/home/user',
});

test('checkouts of one repository collapse into a single group', () => {
  const groups = groupProjectsByRepository([mainCheckout, worktreeA, worktreeB]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].repositoryId, CLOUDCLI_REPO);
  assert.equal(groups[0].checkouts.length, 3);
});

test('a repository with one checkout renders ungrouped, as before', () => {
  // The regression guarded here: wrapping a lone project in a repository header
  // adds a level of indent and tells the user nothing.
  const groups = groupProjectsByRepository([soloRepository, plainFolder]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.repositoryId),
    [null, null],
  );
  assert.deepEqual(
    groups.map((group) => group.checkouts.length),
    [1, 1],
  );
});

test('the group takes the position of its highest-sorted member', () => {
  const groups = groupProjectsByRepository([soloRepository, worktreeA, plainFolder, mainCheckout]);

  assert.deepEqual(
    groups.map((group) => group.key),
    ['p-oney', CLOUDCLI_REPO, 'p-home'],
    'the cloudcli group should sit where its first member was, not be appended',
  );
});

test('the main checkout leads its group and is identified as such', () => {
  const groups = groupProjectsByRepository([worktreeB, worktreeA, mainCheckout]);

  assert.equal(groups[0].checkouts[0].projectId, 'p-main');
  assert.equal(isMainCheckout(mainCheckout), true);
  assert.equal(isMainCheckout(worktreeA), false);
});

test('the header is named after the main checkout when it is registered', () => {
  const groups = groupProjectsByRepository([mainCheckout, worktreeA]);
  assert.equal(groups[0].repositoryName, 'cloudcli');
});

test('the header falls back to the repository directory when the main checkout is not a project', () => {
  // Two worktrees registered, main checkout never added to the sidebar.
  const groups = groupProjectsByRepository([worktreeA, worktreeB]);

  assert.equal(groups[0].repositoryName, 'cloudcli');
  assert.equal(groups[0].checkouts.length, 2);
});

test('projects are searchable by branch', () => {
  const matches = filterProjects([mainCheckout, worktreeA, worktreeB], 'tts-and-stt');

  assert.deepEqual(
    matches.map((match) => match.projectId),
    ['p-tts'],
  );
});

test('a search that matches only some checkouts leaves the rest out of the group', () => {
  const filtered = filterProjects([mainCheckout, worktreeA, worktreeB], 'cloudcli-wt');
  const groups = groupProjectsByRepository(filtered);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].checkouts.map((checkout) => checkout.projectId),
    ['p-tts', 'p-codex'],
  );
});
