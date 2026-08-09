import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSidebarSessionSignals,
  reduceSidebarSessionSignals,
} from './sidebarSessionSignals';

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
