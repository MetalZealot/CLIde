import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project, ProjectSession } from '../../../types/app';
import type { RepositoryViewOptions } from '../types/types';

import {
  applyBrowseSessionViewOptions,
  applyRepositoryViewOptions,
  buildRepositoryEntries,
  collectBrowseSessions,
  DEFAULT_BROWSE_SESSION_VIEW_OPTIONS,
  DEFAULT_REPOSITORY_VIEW_OPTIONS,
  filterProjectsBySessionTitle,
  getCheckoutContextLabel,
  isDefaultBrowseSessionView,
  isDefaultRepositoryView,
  isMainCheckout,
  mergeCheckoutSessions,
  repositoryEntryKey,
  resolveActivityState,
  sortRepositoryEntries,
  summarizeSessionActivity,
} from './utils';
import {
  compactHomePath,
  getBatchSelectableWorktrees,
  getWorktreeSessionCount,
  shouldShowWorktreePath,
} from './worktreeManager';

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

test('Projects view sorts repository rows by name or latest activity', () => {
  const entries = buildRepositoryEntries([soloRepository, mainCheckout, worktreeA]);

  assert.deepEqual(
    sortRepositoryEntries(entries, { sort: 'name', direction: 'asc' }).map((item) => item.displayName),
    ['cloudcli', 'oney-index'],
  );
  assert.deepEqual(
    sortRepositoryEntries(entries, { sort: 'date', direction: 'asc' }).map((item) => item.displayName),
    ['oney-index', 'cloudcli'],
    'the merged row sorts by its newest checkout, not whichever checkout appeared first',
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

test('a pinned session stays in its repository and leads the row', () => {
  const starredInWorktree = project({
    ...worktreeB,
    sessions: [session('s-starred', '2026-07-01T10:00:00Z', { isStarred: true })],
  });

  const [entry] = buildRepositoryEntries([mainCheckout, worktreeA, starredInWorktree]);
  assert.deepEqual(
    mergeCheckoutSessions(entry).map(({ session: item }) => item.id),
    ['s-starred', 's-tts-new', 's-main-old'],
  );
});

test('Sessions view gathers pins across repositories before recent unpinned sessions', () => {
  const pinnedHere = project({
    ...worktreeA,
    sessions: [session('s-old-pin', '2026-07-01T10:00:00Z', { isStarred: true })],
  });
  const pinnedThere = project({
    ...soloRepository,
    sessions: [session('s-new-pin', '2026-08-03T10:00:00Z', { isStarred: true })],
  });

  const sessions = collectBrowseSessions(buildRepositoryEntries([pinnedHere, pinnedThere, mainCheckout]));

  assert.deepEqual(
    sessions.map(({ session: item }) => item.id),
    ['s-new-pin', 's-old-pin', 's-main-old'],
  );
  assert.deepEqual(
    sessions.map(({ repositoryName }) => repositoryName),
    ['oney-index', 'cloudcli', 'cloudcli'],
  );
  assert.equal(sessions[1].checkout.projectId, 'p-tts', 'selecting it must open its own checkout');
});

test('Sessions view gives worktree sessions the repository row highlight', () => {
  const highlightedMain = project({ ...mainCheckout, accentColor: 'violet' });
  const differentlyColoredWorktree = project({ ...worktreeA, accentColor: 'amber' });

  const sessions = collectBrowseSessions(
    buildRepositoryEntries([highlightedMain, differentlyColoredWorktree]),
  );
  const worktreeSession = sessions.find(({ session: item }) => item.id === 's-tts-new');

  assert.equal(worktreeSession?.checkout.projectId, 'p-tts');
  assert.equal(worktreeSession?.repositoryAccentColor, 'violet');
});

test('Sessions view flattens unpinned repositories by recency', () => {
  const pinnedHere = project({
    ...mainCheckout,
    sessions: [session('s-main', '2026-08-01T10:00:00Z')],
  });
  const entries = buildRepositoryEntries([pinnedHere, worktreeA, soloRepository]);

  const browseSessions = collectBrowseSessions(entries);

  assert.deepEqual(
    browseSessions.map(({ session: item }) => item.id),
    ['s-tts-new', 's-oney', 's-main'],
  );
  assert.deepEqual(
    browseSessions.map(({ repositoryName }) => repositoryName),
    ['cloudcli', 'oney-index', 'cloudcli'],
  );
});

test('Sessions view sorts every project by title without disturbing pins', () => {
  const translate = ((key: string) => key) as unknown as Parameters<
    typeof applyBrowseSessionViewOptions
  >[2];
  const pinnedMain = project({
    ...mainCheckout,
    sessions: [session('s-pinned', '2026-07-01T10:00:00Z', {
      isStarred: true,
      summary: 'Zebra pinned',
    })],
  });
  const namedSolo = project({
    ...soloRepository,
    sessions: [session('s-oney', '2026-08-03T10:00:00Z', { summary: 'Alpha session' })],
  });
  const sessions = collectBrowseSessions(
    buildRepositoryEntries([pinnedMain, worktreeA, worktreeB, namedSolo]),
  );
  const sorted = applyBrowseSessionViewOptions(sessions, {
    sort: 'title',
    direction: 'asc',
  }, translate);

  assert.deepEqual(
    sorted.map(({ session: item }) => item.id),
    ['s-pinned', 's-oney', 's-codex-mid', 's-tts-new'],
    'the pin leads even though its title sorts last',
  );
  assert.equal(isDefaultBrowseSessionView(DEFAULT_BROWSE_SESSION_VIEW_OPTIONS), true);
});

test('activity summary counts each session at its highest-urgency state', () => {
  const entries = buildRepositoryEntries([mainCheckout, worktreeA, worktreeB, soloRepository]);
  const activeSessionIds = new Set(['s-main-old', 's-tts-new', 's-codex-mid']);
  const attentionSessionIds = new Set(['s-main-old']);
  const unreadSessionIds = new Set(['s-oney']);

  const summary = summarizeSessionActivity(
    entries,
    activeSessionIds,
    attentionSessionIds,
    unreadSessionIds,
  );

  assert.deepEqual(summary, { blocked: 1, running: 2, unread: 1 });
});

test('activity summary assigns overlapping states once', () => {
  const entries = buildRepositoryEntries([mainCheckout]);
  const sessionIds = new Set(['s-main-old']);

  const summary = summarizeSessionActivity(entries, sessionIds, sessionIds, sessionIds);

  assert.deepEqual(summary, { blocked: 1, running: 0, unread: 0 });
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
  mergeCheckoutSessions(buildRepositoryEntries([mainCheckout, worktreeA, worktreeB])[0]);

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

test('reversing the date sort is the exact reverse of the default', () => {
  const oldest = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'date', direction: 'asc', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    oldest.map(({ session }) => session.id),
    ['s-main-old', 's-codex-mid', 's-tts-new'],
  );

  // A reversed default is not the default, or the header would not light up.
  assert.equal(
    isDefaultRepositoryView({ sort: 'date', direction: 'asc', worktreeProjectIds: null }),
    false,
  );
});

test('pinning outranks a repository custom sort', () => {
  const pinnedMain = project({
    ...mainCheckout,
    sessions: [session('s-pinned', '2026-07-01T10:00:00Z', {
      isStarred: true,
      summary: 'Zebra pinned',
    })],
  });
  const [entry] = buildRepositoryEntries([pinnedMain, worktreeA, worktreeB]);

  const byOldest = applyRepositoryViewOptions(
    mergeCheckoutSessions(entry),
    { sort: 'date', direction: 'asc', worktreeProjectIds: null },
    fallbackName,
  );
  const byTitle = applyRepositoryViewOptions(
    mergeCheckoutSessions(entry),
    { sort: 'title', direction: 'asc', worktreeProjectIds: null },
    fallbackName,
  );

  assert.equal(byOldest[0].session.id, 's-pinned');
  assert.equal(byTitle[0].session.id, 's-pinned');
});

test('title sorts by displayed name, and reverses on demand', () => {
  const byTitle = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'title', direction: 'asc', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    byTitle.map(({ session }) => session.summary),
    ['Codex parity review', 'Review the merge plan', 'Wire up speech playback'],
  );

  const reversed = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'title', direction: 'desc', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    reversed.map(({ session }) => session.summary),
    ['Wire up speech playback', 'Review the merge plan', 'Codex parity review'],
  );
});

test('worktree sort groups by branch label, newest first inside a group', () => {
  const grouped = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'worktree', direction: 'asc', worktreeProjectIds: null },
    fallbackName,
  );

  // feature/tts-and-stt < main < test/codex
  assert.deepEqual(
    grouped.map(({ checkout }) => checkout.branch),
    ['feature/tts-and-stt', 'main', 'test/codex'],
  );

  const reversed = applyRepositoryViewOptions(
    mergedRow(),
    { sort: 'worktree', direction: 'desc', worktreeProjectIds: null },
    fallbackName,
  );
  assert.deepEqual(
    reversed.map(({ checkout }) => checkout.branch),
    ['test/codex', 'main', 'feature/tts-and-stt'],
  );
});

test('a worktree filter keeps only the checkouts it names', () => {
  const view: RepositoryViewOptions = {
    sort: 'date',
    direction: 'desc',
    worktreeProjectIds: ['p-codex'],
  };
  const filtered = applyRepositoryViewOptions(mergedRow(), view, fallbackName);

  assert.deepEqual(
    filtered.map(({ session }) => session.id),
    ['s-codex-mid'],
  );
  // The header's lit state reads off this, so a real filter must not look default.
  assert.equal(isDefaultRepositoryView(view), false);
});

const discoveredMainCheckout = project({
  projectId: 'discovered:/home/user/Projects/cloudcli',
  displayName: 'cloudcli',
  fullPath: '/home/user/Projects/cloudcli',
  repositoryId: CLOUDCLI_REPO,
  branch: 'main',
  isDiscovered: true,
});

const discoveredWorktree = project({
  projectId: 'discovered:/home/user/Projects/cloudcli-wt-hierarchy',
  displayName: 'cloudcli-wt-hierarchy',
  fullPath: '/home/user/Projects/cloudcli-wt-hierarchy',
  repositoryId: CLOUDCLI_REPO,
  branch: 'feat/sidebar-hierarchy',
  isDiscovered: true,
});

test('a discovered worktree joins its repository row', () => {
  const entries = buildRepositoryEntries([mainCheckout, discoveredWorktree]);

  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0].checkouts.map((checkout) => checkout.projectId),
    ['p-main', 'discovered:/home/user/Projects/cloudcli-wt-hierarchy'],
  );
});

test('a discovered checkout never leads its row, even when it is the main worktree', () => {
  // Registering only a worktree leaves the main checkout to be discovered. Git
  // calls it the main worktree, but it has no row, so every repository-scoped
  // action would 404 against its synthetic id.
  const entries = buildRepositoryEntries([worktreeA, discoveredMainCheckout]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].leadCheckout.projectId, 'p-tts');
  assert.equal(isMainCheckout(discoveredMainCheckout), true);
});

test('a registered main checkout still leads once discoveries are present', () => {
  const entries = buildRepositoryEntries([worktreeA, mainCheckout, discoveredWorktree]);

  assert.equal(entries[0].leadCheckout.projectId, 'p-main');
});

test('the checkout label names a working tree only when the row covers several', () => {
  // One checkout: the project name already says which tree this is.
  assert.equal(getCheckoutContextLabel(soloRepository, [soloRepository, plainFolder]), null);
  assert.equal(getCheckoutContextLabel(plainFolder, [soloRepository, plainFolder]), null);

  assert.equal(
    getCheckoutContextLabel(worktreeA, [mainCheckout, worktreeA]),
    'cloudcli-wt-tts · feature/tts-and-stt',
  );
  // A discovered sibling makes the row ambiguous just as a registered one does.
  assert.equal(
    getCheckoutContextLabel(mainCheckout, [mainCheckout, discoveredWorktree]),
    'cloudcli · main',
  );
});

test('a detached checkout is labelled by its commit, never as a branch', () => {
  const detached = project({
    projectId: 'p-detached',
    displayName: 'cloudcli-wt-detached',
    fullPath: '/home/user/Projects/cloudcli-wt-detached',
    repositoryId: CLOUDCLI_REPO,
    detachedHead: 'c496391',
  });

  assert.equal(
    getCheckoutContextLabel(detached, [mainCheckout, detached]),
    'cloudcli-wt-detached · detached @ c496391',
  );
});

// --- worktreeManager --------------------------------------------------------

const registered: Project = {
  projectId: 'registered',
  displayName: 'Registered',
  fullPath: '/workspace/registered',
  sessions: [{ id: 'loaded-session' }],
  sessionMeta: { total: 12, hasMore: true },
};

test('worktree session count uses the server total beyond the loaded page', () => {
  assert.equal(getWorktreeSessionCount(registered), 12);
  assert.equal(getWorktreeSessionCount({ ...registered, sessionMeta: undefined }), 1);
});

test('batch selection excludes discovered checkouts with synthetic ids', () => {
  const discovered: Project = {
    ...registered,
    projectId: 'discovered:/workspace/discovered',
    fullPath: '/workspace/discovered',
    isDiscovered: true,
    sessions: [],
    sessionMeta: { total: 0, hasMore: false },
  };

  assert.deepEqual(getBatchSelectableWorktrees([registered, discovered]), [registered]);
});

test('a path the name already gives away does not get its own line', () => {
  const lead = '/home/g/Projects/cloudcli';
  const beside = (fullPath: string, displayName: string): Project => ({
    ...registered,
    displayName,
    fullPath,
  });

  assert.equal(shouldShowWorktreePath(beside(lead, 'cloudcli'), lead), false);
  assert.equal(
    shouldShowWorktreePath(beside('/home/g/Projects/cloudcli-wt-tts', 'cloudcli-wt-tts'), lead),
    false,
  );
  // Renamed in CLIde, so the directory is no longer recoverable from the row.
  assert.equal(shouldShowWorktreePath(beside('/home/g/Projects/cloudcli-wt-tts', 'Voice'), lead), true);
  // Not beside the repository.
  assert.equal(shouldShowWorktreePath(beside('/mnt/external/cloudcli-wt-tts', 'cloudcli-wt-tts'), lead), true);
});

test('home paths keep their useful suffix without assuming a username', () => {
  assert.equal(compactHomePath('/home/grayson/Projects/cloudcli'), '~/Projects/cloudcli');
  assert.equal(compactHomePath('/srv/cloudcli'), '/srv/cloudcli');
});
