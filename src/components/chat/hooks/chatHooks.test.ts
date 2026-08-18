// Pure helpers exported by the chat hooks: composer popover routing, send-time
// model/effort selection, effort/model compatibility, and realtime
// permission-request de-duplication.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PendingPermissionRequest } from '../types/types';

import { resolveSessionSendSetting, resolveUsagePopoverView } from './useChatComposerState';
import { reconcileEffortForAllowedValues } from './useChatProviderState';
import { dedupePermissionRequestsById } from './useChatRealtimeHandlers';

// --- useChatComposerState ---------------------------------------------------

test('usage commands route to provider-specific popover detail', () => {
  assert.equal(resolveUsagePopoverView('usage', 'claude'), 'summary');
  assert.equal(resolveUsagePopoverView('usage', 'codex'), 'activity');
  assert.equal(resolveUsagePopoverView('cost', 'codex'), 'activity');
});

test('context commands expose only Claude breakdown detail', () => {
  assert.equal(resolveUsagePopoverView('context', 'claude'), 'breakdown');
  assert.equal(resolveUsagePopoverView('context', 'codex'), 'summary');
  assert.equal(resolveUsagePopoverView('status', 'claude'), null);
});

test('a queued send carries the session\'s own effort, never the provider seed', () => {
  // The snapshot buildSendOptions takes at queue time is dispatched verbatim,
  // so this is also what a message queued behind a running turn sends.
  assert.equal(resolveSessionSendSetting('medium', 'high', true), 'medium');
  assert.equal(resolveSessionSendSetting('opus', 'sonnet', true), 'opus');
});

test('an established session with no tracked value sends none, so the server resolves', () => {
  assert.equal(resolveSessionSendSetting(null, 'high', true), undefined);
  assert.equal(resolveSessionSendSetting(undefined, 'high', true), undefined);
});

test('only a chat with no id yet inherits the provider seed', () => {
  assert.equal(resolveSessionSendSetting(null, 'high', false), 'high');
  assert.equal(resolveSessionSendSetting(null, undefined, false), undefined);
});

// --- useChatProviderState ---------------------------------------------------

test('a model change drops an effort that model does not offer', () => {
  assert.equal(reconcileEffortForAllowedValues('xhigh', ['low', 'medium', 'high']), 'default');
});

test('an effort the new model still offers survives the change', () => {
  assert.equal(reconcileEffortForAllowedValues('medium', ['low', 'medium', 'high']), 'medium');
});

test('an explicit default stays the standing choice across a model change', () => {
  assert.equal(reconcileEffortForAllowedValues('default', ['low', 'high']), 'default');
});

test('a model offering no effort at all resolves to default rather than a guess', () => {
  assert.equal(reconcileEffortForAllowedValues('high', []), 'default');
  assert.equal(reconcileEffortForAllowedValues('', ['low', 'high']), 'default');
});

// --- useChatRealtimeHandlers ------------------------------------------------

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
