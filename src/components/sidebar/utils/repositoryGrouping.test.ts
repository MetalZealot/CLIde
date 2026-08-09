import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project, ProjectSession } from '../../../types/app';

import {
  applyRepositoryViewOptions,
  buildRepositoryEntries,
  collectActivitySessions,
  collectPinnedSessions,
  DEFAULT_REPOSITORY_VIEW_OPTIONS,
  filterProjectsByRepositoryEntry,
  filterProjectsBySessionTitle,
  getUnpinnedCheckoutSessions,
  isDefaultRepositoryView,
  isMainCheckout,
  mergeCheckoutSessions,
  repositoryEntryKey,
  resolveActivityState,
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
  sessions: [session('s-main-old', '2026-08-01T10:00:00Z', { summary: 'Review the merge plan' })],
});

const worktreeA = project({
  projectId: 'p-tts',
  displayName: 'cloudcli-wt-tts',
  fullPath: '/home/user/Projects/cloudcli-wt-tts',
  repositoryId: CLOUDCLI_REPO,
  branch: 'feature/tts-and-stt',
  sessions: [session('s-tts-new', '2026-08-04T10:00:00Z', { summary: 'Wire up speech playback' })],
});

const worktreeB = project({
  projectId: 'p-codex',
  displayName: 'cloudcli-wt-codex',
  fullPath: '/home/user/Projects/cloudcli-wt-codex',
  repositoryId: CLOUDCLI_REPO,
  branch: 'test/codex',
  sessions: [session('s-codex-mid', '2026-08-02T10:00:00Z', { summary: 'Codex parity review' })],
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
  const narrowed = buildRepositoryEntries(
    filterProjectsBySessionTitle([mainCheckout, worktreeA, worktreeB], 'speech'),
  );

  assert.equal(everything[0].key, narrowed[0].key);
  assert.equal(repositoryEntryKey(worktreeA), CLOUDCLI_REPO);
  assert.equal(repositoryEntryKey(plainFolder), 'p-home', 'a non-repo folder keys on its own id');
});

test('project scope keeps every checkout belonging to the selected repository row', () => {
  const scoped = filterProjectsByRepositoryEntry(
    [mainCheckout, worktreeA, soloRepository, worktreeB],
    CLOUDCLI_REPO,
  );

  assert.deepEqual(
    scoped.map((item) => item.projectId),
    ['p-main', 'p-tts', 'p-codex'],
  );
  assert.equal(
    filterProjectsByRepositoryEntry([mainCheckout, soloRepository], null).length,
    2,
    'the All projects choice must preserve the complete list',
  );
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

test('a pinned session leaves its row and is listed once, in Pinned', () => {
  const starredInWorktree = project({
    ...worktreeB,
    sessions: [session('s-starred', '2026-07-01T10:00:00Z', { isStarred: true })],
  });

  const entries = buildRepositoryEntries([mainCheckout, worktreeA, starredInWorktree]);
  const rowSessions = getUnpinnedCheckoutSessions(entries[0]).map(({ session: item }) => item.id);
  const pinned = collectPinnedSessions(entries).map(({ session: item }) => item.id);

  assert.deepEqual(rowSessions, ['s-tts-new', 's-main-old'], 'the row must not repeat a pinned session');
  assert.deepEqual(pinned, ['s-starred']);
  // Together the two lists are the merged list exactly once over: pinning moves
  // a session, it does not copy it.
  assert.deepEqual(
    [...rowSessions, ...pinned].sort(),
    mergeCheckoutSessions(entries[0]).map(({ session: item }) => item.id).sort(),
  );
});

test('Pinned gathers across repositories, newest first, naming each one', () => {
  const pinnedHere = project({
    ...worktreeA,
    sessions: [session('s-old-pin', '2026-07-01T10:00:00Z', { isStarred: true })],
  });
  const pinnedThere = project({
    ...soloRepository,
    sessions: [session('s-new-pin', '2026-08-03T10:00:00Z', { isStarred: true })],
  });

  const pinned = collectPinnedSessions(buildRepositoryEntries([pinnedHere, pinnedThere]));

  assert.deepEqual(
    pinned.map(({ session: item }) => item.id),
    ['s-new-pin', 's-old-pin'],
    'the section orders by activity, not by the row each session came from',
  );
  // A session out of its row still has to say where it belongs — under the
  // same name the row it left carries.
  assert.deepEqual(
    pinned.map(({ repositoryName }) => repositoryName),
    ['oney-index', 'cloudcli-wt-tts'],
  );
  assert.equal(pinned[1].checkout.projectId, 'p-tts', 'selecting it must open its own checkout');
});

test('Activity copies sessions and orders blocked, running, then unread', () => {
  const entries = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB, soloRepository]);
  const activeSessionIds = new Set(['s-main-old', 's-tts-new', 's-codex-mid']);
  const attentionSessionIds = new Set(['s-main-old']);
  const unreadSessionIds = new Set(['s-oney']);

  const activity = collectActivitySessions(
    entries,
    activeSessionIds,
    attentionSessionIds,
    unreadSessionIds,
  );

  assert.deepEqual(
    activity.map(({ session: item, activityState }) => [item.id, activityState]),
    [
      ['s-main-old', 'blocked'],
      ['s-tts-new', 'running'],
      ['s-codex-mid', 'running'],
      ['s-oney', 'unread'],
    ],
  );
  assert.ok(
    mergeCheckoutSessions(entries[0]).some(({ session: item }) => item.id === 's-main-old'),
    'Activity must copy a session instead of removing it from its repository row',
  );
});

test('Activity assigns overlapping states to the highest urgency only', () => {
  const entries = buildRepositoryEntries([mainCheckout]);
  const sessionIds = new Set(['s-main-old']);

  const [activity] = collectActivitySessions(entries, sessionIds, sessionIds, sessionIds);

  assert.equal(activity.activityState, 'blocked');
});

test('sidebar status resolves blocked, then running, then unread', () => {
  assert.equal(resolveActivityState({ isProcessing: true, needsAttention: true, isUnread: true }), 'blocked');
  assert.equal(resolveActivityState({ isProcessing: true, needsAttention: false, isUnread: true }), 'running');
  assert.equal(resolveActivityState({ isProcessing: false, needsAttention: false, isUnread: true }), 'unread');
  assert.equal(resolveActivityState({ isProcessing: false, needsAttention: false, isUnread: false }), null);
});

test('search matches session names, not project names, paths, or branches', () => {
  // Every one of these used to be a hit; searching for a repository is exactly
  // what this filter stopped doing.
  for (const query of ['cloudcli', 'Projects', 'tts-and-stt']) {
    assert.deepEqual(
      filterProjectsBySessionTitle([mainCheckout, worktreeA, worktreeB], query),
      [],
      `"${query}" names a project, so it must not match anything`,
    );
  }

  const matches = filterProjectsBySessionTitle([mainCheckout, worktreeA, worktreeB], 'speech');

  assert.deepEqual(
    matches.map((match) => match.projectId),
    ['p-tts'],
  );
});

test('a matching row keeps only its matching sessions, and counts them', () => {
  const busyWorktree = project({
    ...worktreeA,
    sessions: [
      session('s-hit', '2026-08-04T10:00:00Z', { summary: 'Wire up speech playback' }),
      session('s-miss', '2026-08-03T10:00:00Z', { summary: 'Unrelated work' }),
    ],
    sessionMeta: { total: 40, hasMore: true },
  });

  const [match] = filterProjectsBySessionTitle([busyWorktree], 'speech');

  assert.deepEqual(match.sessions?.map((item) => item.id), ['s-hit']);
  // The row's "22 sessions" and its "show more" have to describe the matches,
  // or the count contradicts the list it opens.
  assert.equal(match.sessionMeta?.total, 1);
  assert.equal(match.sessionMeta?.hasMore, false);
});

test('a search that matches only some checkouts leaves the rest out of the row', () => {
  const filtered = filterProjectsBySessionTitle([mainCheckout, worktreeA, worktreeB], 'review');
  const entries = buildRepositoryEntries(filtered);

  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0].checkouts.map((checkout) => checkout.projectId),
    ['p-main', 'p-codex'],
  );
});

/** The row list a view is applied to: three checkouts, three activity dates. */
const mergedRow = () =>
  getUnpinnedCheckoutSessions(buildRepositoryEntries([mainCheckout, worktreeA, worktreeB])[0]);

// `getSessionName`'s fallback, which the title sort has to see rather than the
// empty summary underneath it.
const fallbackName = ((key: string) => key) as unknown as Parameters<
  typeof applyRepositoryViewOptions
>[2];

test('the default view is newest first across every checkout', () => {
  const ordered = applyRepositoryViewOptions(
    mergedRow(),
    DEFAULT_REPOSITORY_VIEW_OPTIONS,
    fallbackName,
  );

  assert.deepEqual(
    ordered.map(({ session }) => session.id),
    ['s-tts-new', 's-codex-mid', 's-main-old'],
  );
  assert.ok(isDefaultRepositoryView(DEFAULT_REPOSITORY_VIEW_OPTIONS));
});

test('oldest-first is the exact reverse, and title sorts by displayed name', () => {
  const oldest = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'oldest', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    oldest.map(({ session }) => session.id),
    ['s-main-old', 's-codex-mid', 's-tts-new'],
  );

  const byTitle = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'title', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    byTitle.map(({ session }) => session.summary),
    ['Codex parity review', 'Review the merge plan', 'Wire up speech playback'],
  );
});

test('worktree sort groups by branch label, newest first inside a group', () => {
  const grouped = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'worktree', worktreeProjectIds: null },
    fallbackName,
  );

  // feature/tts-and-stt < main < test/codex
  assert.deepEqual(
    grouped.map(({ checkout }) => checkout.branch),
    ['feature/tts-and-stt', 'main', 'test/codex'],
  );
});

test('a worktree filter keeps only the checkouts it names', () => {
  const filtered = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'recent', worktreeProjectIds: ['p-codex'] },
    fallbackName,
  );

  assert.deepEqual(
    filtered.map(({ session }) => session.id),
    ['s-codex-mid'],
  );
  // The header's lit state reads off this, so a real filter must not look default.
  assert.equal(
    isDefaultRepositoryView({ sort: 'recent', worktreeProjectIds: ['p-codex'] }),
    false,
  );
});
