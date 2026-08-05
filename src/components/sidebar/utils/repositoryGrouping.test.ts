import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project, ProjectSession } from '../../../types/app';

import {
  buildRepositoryEntries,
  filterProjects,
  isMainCheckout,
  mergeCheckoutSessions,
  repositoryEntryKey,
} from './utils';

const CLOUDCLI_REPO = '/home/user/Projects/cloudcli/.git';

const session = (id: string, lastActivity: string, extra: Partial<ProjectSession> = {}) =>
  ({ id, lastActivity, ...extra }) as ProjectSession;

const project = (overrides: Partial<Project> & { projectId: string; fullPath: string }): Project => ({
  displayName: overrides.projectId,
  repositoryId: null,
  branch: null,
  detachedHead: null,
  sessions: [],
  ...overrides,
});

const mainCheckout = project({
  projectId: 'p-main',
  displayName: 'cloudcli',
  fullPath: '/home/user/Projects/cloudcli',
  repositoryId: CLOUDCLI_REPO,
  branch: 'main',
  sessions: [session('s-main-old', '2026-08-01T10:00:00Z')],
});

const worktreeA = project({
  projectId: 'p-tts',
  displayName: 'cloudcli-wt-tts',
  fullPath: '/home/user/Projects/cloudcli-wt-tts',
  repositoryId: CLOUDCLI_REPO,
  branch: 'feature/tts-and-stt',
  sessions: [session('s-tts-new', '2026-08-04T10:00:00Z')],
});

const worktreeB = project({
  projectId: 'p-codex',
  displayName: 'cloudcli-wt-codex',
  fullPath: '/home/user/Projects/cloudcli-wt-codex',
  repositoryId: CLOUDCLI_REPO,
  branch: 'test/codex',
  sessions: [session('s-codex-mid', '2026-08-02T10:00:00Z')],
});

const soloRepository = project({
  projectId: 'p-oney',
  displayName: 'oney-index',
  fullPath: '/home/user/Projects/oney-index',
  repositoryId: '/home/user/Projects/oney-index/.git',
  branch: 'master',
  sessions: [session('s-oney', '2026-08-03T10:00:00Z')],
});

const plainFolder = project({
  projectId: 'p-home',
  displayName: 'home',
  fullPath: '/home/user',
});

test('checkouts of one repository collapse into a single row', () => {
  const entries = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB]);

  assert.equal(entries.length, 1, 'three checkouts must not produce three rows');
  assert.equal(entries[0].repositoryId, CLOUDCLI_REPO);
  assert.equal(entries[0].checkouts.length, 3);
});

test('a repository with one checkout is an ordinary project row', () => {
  const entries = buildRepositoryEntries([soloRepository, plainFolder]);

  assert.deepEqual(
    entries.map((entry) => entry.displayName),
    ['oney-index', 'home'],
    'a lone checkout keeps its own name rather than being relabelled',
  );
  assert.deepEqual(
    entries.map((entry) => entry.checkouts.length),
    [1, 1],
  );
});

test('the row takes the position of its highest-sorted checkout', () => {
  const entries = buildRepositoryEntries([soloRepository, worktreeA, plainFolder, mainCheckout]);

  assert.deepEqual(
    entries.map((entry) => entry.displayName),
    ['oney-index', 'cloudcli', 'home'],
    'the cloudcli row should sit where its first checkout was, not be appended',
  );
});

test('the main checkout leads and names the row', () => {
  const entries = buildRepositoryEntries([worktreeB, worktreeA, mainCheckout]);

  assert.equal(entries[0].leadCheckout.projectId, 'p-main');
  assert.equal(entries[0].displayName, 'cloudcli');
  assert.equal(isMainCheckout(mainCheckout), true);
  assert.equal(isMainCheckout(worktreeA), false);
});

test('the row falls back to the repository directory when the main checkout is not a project', () => {
  // Two worktrees registered, main checkout never added to the sidebar.
  const entries = buildRepositoryEntries([worktreeA, worktreeB]);

  assert.equal(entries[0].displayName, 'cloudcli');
  assert.equal(entries[0].leadCheckout.projectId, 'p-tts', 'lead falls back to the first checkout');
});

test('the row key never depends on which checkouts survive a filter', () => {
  // The regression guarded here: deriving the key from the visible list would
  // re-key a repository whose siblings are filtered out, collapsing an open row.
  const everything = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB]);
  const narrowed = buildRepositoryEntries(filterProjects([mainCheckout, worktreeA, worktreeB], 'tts'));

  assert.equal(everything[0].key, narrowed[0].key);
  assert.equal(repositoryEntryKey(worktreeA), CLOUDCLI_REPO);
  assert.equal(repositoryEntryKey(plainFolder), 'p-home', 'a non-repo folder keys on its own id');
});

test('sessions from every checkout merge into one activity-ordered list', () => {
  const [entry] = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB]);
  const merged = mergeCheckoutSessions(entry);

  assert.deepEqual(
    merged.map(({ session: item }) => item.id),
    ['s-tts-new', 's-codex-mid', 's-main-old'],
    'merged sessions sort by activity across checkouts, not grouped by checkout',
  );
});

test('a merged session keeps the checkout it belongs to, not the lead', () => {
  const [entry] = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB]);
  const merged = mergeCheckoutSessions(entry);
  const ttsSession = merged.find(({ session: item }) => item.id === 's-tts-new');

  // Selecting this row has to switch the app to the worktree that session runs
  // in; pointing it at the lead checkout would run it against the wrong tree.
  assert.equal(ttsSession?.checkout.projectId, 'p-tts');
  assert.equal(ttsSession?.branchLabel, 'feature/tts-and-stt');
});

test('a single-checkout row labels no branch on its sessions', () => {
  const [entry] = buildRepositoryEntries([soloRepository]);
  const merged = mergeCheckoutSessions(entry);

  assert.equal(
    merged[0].branchLabel,
    null,
    'there is nothing to disambiguate, so the label would only be noise',
  );
});

test('a detached checkout labels its sessions with a short SHA, not "HEAD"', () => {
  const detached = project({
    projectId: 'p-detached',
    fullPath: '/home/user/Projects/cloudcli-wt-detached',
    repositoryId: CLOUDCLI_REPO,
    branch: null,
    detachedHead: 'a1b2c3d',
    sessions: [session('s-detached', '2026-08-05T10:00:00Z')],
  });

  const [entry] = buildRepositoryEntries([mainCheckout, detached]);
  const merged = mergeCheckoutSessions(entry);

  assert.equal(merged[0].branchLabel, 'detached @ a1b2c3d');
});

test('starred sessions lead the merged list regardless of checkout', () => {
  const starredInWorktree = project({
    ...worktreeB,
    sessions: [session('s-starred', '2026-07-01T10:00:00Z', { isStarred: true })],
  });

  const [entry] = buildRepositoryEntries([mainCheckout, worktreeA, starredInWorktree]);
  const merged = mergeCheckoutSessions(entry);

  assert.equal(merged[0].session.id, 's-starred');
});

test('projects are searchable by branch', () => {
  const matches = filterProjects([mainCheckout, worktreeA, worktreeB], 'tts-and-stt');

  assert.deepEqual(
    matches.map((match) => match.projectId),
    ['p-tts'],
  );
});

test('a search that matches only some checkouts leaves the rest out of the row', () => {
  const filtered = filterProjects([mainCheckout, worktreeA, worktreeB], 'cloudcli-wt');
  const entries = buildRepositoryEntries(filtered);

  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0].checkouts.map((checkout) => checkout.projectId),
    ['p-tts', 'p-codex'],
  );
});
