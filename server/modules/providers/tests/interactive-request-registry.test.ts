import assert from 'node:assert/strict';
import test from 'node:test';

import { interactiveRequestRegistry } from '@/modules/providers/services/interactive-request-registry.service.js';

const baseRequest = {
  requestId: 'request-1',
  provider: 'codex' as const,
  sessionId: 'thread-1',
  requestType: 'user_input' as const,
  toolName: 'request_user_input',
  receivedAt: new Date().toISOString(),
};

test.afterEach(() => {
  interactiveRequestRegistry.clearForTests();
});

test('interactive registry replays pending requests and accepts exactly one response', async () => {
  const responses: unknown[] = [];
  interactiveRequestRegistry.register(baseRequest, {
    onResponse: (response) => {
      responses.push(response);
    },
  });

  assert.deepEqual(
    interactiveRequestRegistry.getPendingForSession('thread-1'),
    [baseRequest],
  );

  const first = await interactiveRequestRegistry.resolve('request-1', {
    decision: 'allow_once',
    answers: { question: ['One'] },
  });
  const duplicate = await interactiveRequestRegistry.resolve('request-1', {
    decision: 'deny',
  });

  assert.equal(first.status, 'resolved');
  assert.equal(duplicate.status, 'not_found');
  assert.deepEqual(responses, [{
    decision: 'allow_once',
    answers: { question: ['One'] },
  }]);
});

test('interactive registry keeps malformed responses pending for correction', async () => {
  interactiveRequestRegistry.register(baseRequest, {
    onResponse: () => {
      throw new Error('bad answer');
    },
  });

  assert.deepEqual(await interactiveRequestRegistry.resolve('request-1', {}), {
    status: 'invalid',
    error: 'bad answer',
  });
  assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 1);
});

test('interactive registry timeout invokes the provider adapter and clears replay state', async () => {
  let timedOut = false;
  let settled = '';
  interactiveRequestRegistry.register(baseRequest, {
    timeoutMs: 15,
    onResponse: () => {},
    onTimeout: () => {
      timedOut = true;
    },
    onSettled: (reason) => {
      settled = reason;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(timedOut, true);
  assert.equal(settled, 'timeout');
  assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 0);
});

test('Claude approval with a zero timeout remains pending for the human', async () => {
  let timedOut = false;
  interactiveRequestRegistry.register({
    ...baseRequest,
    provider: 'claude',
    toolName: 'Bash',
  }, {
    timeoutMs: 0,
    onResponse: () => {},
    onTimeout: () => {
      timedOut = true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(timedOut, false);
  assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 1);
});

test('interactive registry server resolution and abort cancellation clear requests', async () => {
  let cancellations = 0;
  interactiveRequestRegistry.register(baseRequest, {
    onResponse: () => {},
    onCancel: () => {
      cancellations += 1;
    },
  });
  assert.equal(await interactiveRequestRegistry.markServerResolved('request-1'), true);
  assert.equal(cancellations, 0);

  interactiveRequestRegistry.register({ ...baseRequest, requestId: 'request-2' }, {
    onResponse: () => {},
    onCancel: () => {
      cancellations += 1;
    },
  });
  await interactiveRequestRegistry.cancelForSession('thread-1');
  assert.equal(cancellations, 1);
  assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 0);
});

test('a pending request is reported only by the provider that owns it', () => {
  // The registry is one process-wide map shared by every runtime, and the
  // gateway's getPendingApprovalsForSession flat-maps over all of them. An
  // unfiltered per-session lookup therefore answered the same entry to each
  // runtime, so `chat.subscribe` replayed one prompt twice and the client
  // rendered two identical question panels on returning to the session.
  interactiveRequestRegistry.register({
    ...baseRequest,
    requestId: 'claude-request',
    provider: 'claude',
    sessionId: 'app-session-1',
    toolName: 'AskUserQuestion',
  }, { onResponse: () => {} });

  assert.deepEqual(
    interactiveRequestRegistry
      .getPendingForSession('app-session-1', 'claude')
      .map((request) => request.requestId),
    ['claude-request'],
  );

  // Codex shares the map but owns nothing in this session.
  assert.deepEqual(
    interactiveRequestRegistry.getPendingForSession('app-session-1', 'codex'),
    [],
  );

  // Unscoped callers still see everything for the session.
  assert.equal(
    interactiveRequestRegistry.getPendingForSession('app-session-1').length,
    1,
  );
});

test('providers sharing a session id each report only their own pending request', () => {
  interactiveRequestRegistry.register({
    ...baseRequest,
    requestId: 'claude-request',
    provider: 'claude',
    sessionId: 'shared-session',
  }, { onResponse: () => {} });
  interactiveRequestRegistry.register({
    ...baseRequest,
    requestId: 'codex-request',
    provider: 'codex',
    sessionId: 'shared-session',
  }, { onResponse: () => {} });

  assert.deepEqual(
    interactiveRequestRegistry
      .getPendingForSession('shared-session', 'claude')
      .map((request) => request.requestId),
    ['claude-request'],
  );
  assert.deepEqual(
    interactiveRequestRegistry
      .getPendingForSession('shared-session', 'codex')
      .map((request) => request.requestId),
    ['codex-request'],
  );
});
