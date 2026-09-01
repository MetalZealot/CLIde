import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../types/app';

import {
  createSidebarSessionSignals,
  reduceSidebarSessionSignals,
} from './sidebarSessionSignals';
import {
  applySessionUpsertToProjects,
  type SessionUpsertedEvent,
} from './useProjectsState';

test('viewing a session clears unread but preserves pending attention', () => {
  let state = createSidebarSessionSignals();
  state = reduceSidebarSessionSignals(state, { type: 'mark_unread', sessionId: 'pending' });
  state = reduceSidebarSessionSignals(state, { type: 'request_attention', sessionId: 'pending' });
  state = reduceSidebarSessionSignals(state, { type: 'view', sessionId: 'pending' });

  assert.equal(state.attentionSessionIds.has('pending'), true);
  assert.equal(state.unreadSessionIds.has('pending'), false);
});

test('resolving a pending request removes attention and marks background activity unread', () => {
  let state = createSidebarSessionSignals();
  state = reduceSidebarSessionSignals(state, { type: 'request_attention', sessionId: 'pending' });
  state = reduceSidebarSessionSignals(state, {
    type: 'resolve_attention',
    sessionId: 'pending',
    markUnread: true,
  });

  assert.equal(state.attentionSessionIds.has('pending'), false);
  assert.equal(state.unreadSessionIds.has('pending'), true);
});

test('ordinary output cannot downgrade a pending-attention session', () => {
  let state = createSidebarSessionSignals();
  state = reduceSidebarSessionSignals(state, { type: 'request_attention', sessionId: 'pending' });
  const unchanged = reduceSidebarSessionSignals(state, { type: 'mark_unread', sessionId: 'pending' });

  assert.equal(unchanged, state);
});

const projectWithSession = (projectId: string, sessionIds: string[]): Project => ({
  projectId,
  path: `/checkouts/${projectId}`,
  fullPath: `/checkouts/${projectId}`,
  displayName: projectId,
  isStarred: false,
  sessions: sessionIds.map((id) => ({ id, summary: id, messageCount: 0, lastActivity: '2026-09-01T00:00:00.000Z', __provider: 'claude' })),
  sessionMeta: { hasMore: false, total: sessionIds.length },
} as Project);

const upsertInto = (projectId: string, sessionId: string): SessionUpsertedEvent => ({
  kind: 'session_upserted',
  sessionId,
  provider: 'claude',
  session: { id: sessionId, summary: sessionId, messageCount: 0, lastActivity: '2026-09-01T00:01:00.000Z' },
  project: {
    projectId,
    path: `/checkouts/${projectId}`,
    fullPath: `/checkouts/${projectId}`,
    displayName: projectId,
    isStarred: false,
  },
} as unknown as SessionUpsertedEvent);

test('a session that moves checkout leaves the project it came from', () => {
  const projects = [projectWithSession('main', ['moved', 'stayed']), projectWithSession('worktree', [])];

  const next = applySessionUpsertToProjects(projects, upsertInto('worktree', 'moved'));

  assert.deepEqual(next[0].sessions?.map((session) => session.id), ['stayed']);
  assert.equal(next[0].sessionMeta?.total, 1);
  assert.deepEqual(next[1].sessions?.map((session) => session.id), ['moved']);
  assert.equal(next[1].sessionMeta?.total, 1);
});

test('a session moving into a project this client has not seen still leaves the old one', () => {
  const projects = [projectWithSession('main', ['moved'])];

  const next = applySessionUpsertToProjects(projects, upsertInto('fresh-worktree', 'moved'));

  assert.deepEqual(next[0].sessions?.map((session) => session.id), []);
  assert.equal(next[0].sessionMeta?.total, 0);
  assert.deepEqual(next[1].sessions?.map((session) => session.id), ['moved']);
});

test('an upsert that changes nothing keeps the same project array', () => {
  const projects = [projectWithSession('main', ['idle'])];
  const unchanged = applySessionUpsertToProjects(projects, {
    ...upsertInto('main', 'idle'),
    session: projects[0].sessions![0],
  });

  assert.equal(unchanged, projects);
});
