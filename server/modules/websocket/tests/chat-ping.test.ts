import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

/**
 * Minimal stand-in for a websocket connection: an EventEmitter so the chat
 * handler's `ws.on('message')` wiring works, collecting every outbound JSON
 * frame for assertions.
 */
class FakeConnection extends EventEmitter {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

type ChatDependencies = Parameters<typeof handleChatConnection>[2];

const noopDependencies: ChatDependencies = {
  spawnFns: {} as never,
  abortFns: {} as never,
  resolveInteractiveRequest: async () => ({ status: 'not_found' as const }),
  getPendingInteractiveRequestsForSession: () => [],
};

function connectFake(): FakeConnection {
  const connection = new FakeConnection();
  handleChatConnection(
    connection as never,
    {} as AuthenticatedWebSocketRequest,
    noopDependencies
  );
  return connection;
}

function connectFakeWithDependencies(
  dependencies: ChatDependencies,
): FakeConnection {
  const connection = new FakeConnection();
  handleChatConnection(
    connection as never,
    {} as AuthenticatedWebSocketRequest,
    dependencies
  );
  return connection;
}

async function settle(): Promise<void> {
  // The message handler is async; let its microtasks drain.
  await new Promise((resolve) => setImmediate(resolve));
}

test('chat.ping is echoed as chat_pong with the client timestamp', async () => {
  const connection = connectFake();
  try {
    connection.emit('message', JSON.stringify({ type: 'chat.ping', ts: 1234567890 }));
    await settle();

    assert.equal(connection.frames.length, 1);
    const frame = connection.frames[0];
    assert.equal(frame.kind, 'chat_pong');
    assert.equal(frame.ts, 1234567890);
    assert.equal(typeof frame.timestamp, 'string');
  } finally {
    connectedClients.clear();
  }
});

test('chat.ping without a numeric ts still answers with a null echo', async () => {
  const connection = connectFake();
  try {
    connection.emit('message', JSON.stringify({ type: 'chat.ping' }));
    await settle();

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'chat_pong');
    assert.equal(connection.frames[0].ts, null);
  } finally {
    connectedClients.clear();
  }
});

test('unknown message types still produce a protocol_error (ping must not regress this)', async () => {
  const connection = connectFake();
  try {
    connection.emit('message', JSON.stringify({ type: 'chat.nonsense' }));
    await settle();

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'protocol_error');
    assert.equal(connection.frames[0].code, 'UNKNOWN_MESSAGE_TYPE');
  } finally {
    connectedClients.clear();
  }
});

test('chat.permission-response forwards normalized decisions and answer arrays', async () => {
  const calls: Array<{ requestId: string; payload: Record<string, unknown> }> = [];
  const connection = connectFakeWithDependencies({
    ...noopDependencies,
    resolveInteractiveRequest: async (requestId, payload) => {
      calls.push({ requestId, payload });
      return { status: 'resolved' as const };
    },
  });
  try {
    connection.emit('message', JSON.stringify({
      type: 'chat.permission-response',
      requestId: 'request-1',
      requestType: 'user_input',
      decision: 'allow_once',
      answers: { stable_id: ['A', 'free text'] },
      allow: true,
    }));
    await settle();

    assert.deepEqual(calls, [{
      requestId: 'request-1',
      payload: {
        allow: true,
        requestType: 'user_input',
        decision: 'allow_once',
        answers: { stable_id: ['A', 'free text'] },
        updatedInput: undefined,
        message: undefined,
        rememberEntry: undefined,
      },
    }]);
    assert.equal(connection.frames.length, 0);
  } finally {
    connectedClients.clear();
  }
});

test('chat.permission-response rejects invalid enums and malformed answer arrays before resolution', async () => {
  let calls = 0;
  const connection = connectFakeWithDependencies({
    ...noopDependencies,
    resolveInteractiveRequest: async () => {
      calls += 1;
      return { status: 'resolved' as const };
    },
  });
  try {
    connection.emit('message', JSON.stringify({
      type: 'chat.permission-response',
      requestId: 'request-1',
      decision: 'always_forever',
    }));
    await settle();
    connection.emit('message', JSON.stringify({
      type: 'chat.permission-response',
      requestId: 'request-2',
      requestType: 'user_input',
      answers: { stable_id: 'not-an-array' },
    }));
    await settle();

    assert.equal(calls, 0);
    assert.deepEqual(connection.frames.map((frame) => frame.code), [
      'INTERACTIVE_RESPONSE_INVALID',
      'INTERACTIVE_RESPONSE_INVALID',
    ]);
  } finally {
    connectedClients.clear();
  }
});
