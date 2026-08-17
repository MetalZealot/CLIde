import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import type { NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';

/**
 * The writer is the one place an account-level event can be mistaken for a
 * transcript row. Decorating `provider_usage` would stamp the running chat's
 * app session id onto an account fact and spend a slot in the replay buffer,
 * so it has to bypass decoration entirely.
 */
const createWriter = () => {
  const frames: Array<Record<string, unknown>> = [];
  const decorated: NormalizedMessage[] = [];
  const connection = {
    readyState: 1,
    send: (data: string) => { frames.push(JSON.parse(data) as Record<string, unknown>); },
  } as unknown as RealtimeClientConnection;

  const writer = new ChatSessionWriter({
    connection,
    userId: 1,
    provider: 'claude',
    providerSessionId: null,
    onProviderSessionId: () => {},
    decorateOutboundEvent: (message) => {
      decorated.push(message);
      return { ...message, sessionId: 'app-session-id', seq: decorated.length } as NormalizedMessage;
    },
  });

  return { writer, frames, decorated };
};

test('a provider_usage push is forwarded raw, without session decoration', () => {
  const { writer, frames, decorated } = createWriter();

  writer.send({
    kind: 'provider_usage',
    provider: 'claude',
    usage: { provider: 'claude', supported: true, windows: [{ id: 'five_hour', utilization: 42 }] },
  });

  assert.equal(decorated.length, 0);
  assert.deepEqual(frames, [{
    kind: 'provider_usage',
    provider: 'claude',
    usage: { provider: 'claude', supported: true, windows: [{ id: 'five_hour', utilization: 42 }] },
  }]);
});

test('a transcript message still goes through decoration', () => {
  const { writer, frames, decorated } = createWriter();

  writer.send({
    id: 'message-1',
    sessionId: 'provider-session-id',
    timestamp: '2026-08-16T12:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    content: 'hello',
  });

  assert.equal(decorated.length, 1);
  assert.equal(frames[0]?.sessionId, 'app-session-id');
  assert.equal(frames[0]?.seq, 1);
});
