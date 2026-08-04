import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupePermissionRequestsById } from './useChatRealtimeHandlers';
import type { PendingPermissionRequest } from '../types/types';

const request = (
  requestId: unknown,
  overrides: Partial<PendingPermissionRequest> = {},
): PendingPermissionRequest => ({
  requestId,
  provider: 'claude',
  requestType: 'user_input',
  toolName: 'AskUserQuestion',
  sessionId: 'app-session-1',
  receivedAt: new Date().toISOString(),
  ...overrides,
} as PendingPermissionRequest);

test('the subscribe ack seats one panel per requestId', () => {
  // The server's pending lookup used to fan out across providers sharing one
  // interactive-request registry, answering a single pending question once per
  // runtime. The ack replaces the list wholesale, so both copies rendered.
  const deduped = dedupePermissionRequestsById([
    request('request-1'),
    request('request-1'),
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].requestId, 'request-1');
});

test('distinct pending requests all survive, in arrival order', () => {
  const deduped = dedupePermissionRequestsById([
    request('request-1'),
    request('request-2', { toolName: 'Bash' }),
    request('request-1'),
    request('request-3'),
  ]);

  assert.deepEqual(
    deduped.map((entry) => entry.requestId),
    ['request-1', 'request-2', 'request-3'],
  );
});

test('entries without a usable id are passed through rather than hidden', () => {
  // They are already broken for decision routing; dropping them would make that
  // harder to notice, not easier.
  const deduped = dedupePermissionRequestsById([
    request(undefined),
    request(''),
    request('request-1'),
  ]);

  assert.equal(deduped.length, 3);
});

test('an empty ack stays empty', () => {
  assert.deepEqual(dedupePermissionRequestsById([]), []);
});
