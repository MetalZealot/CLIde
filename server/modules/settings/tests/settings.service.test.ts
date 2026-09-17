import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    apiKeys: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    preferences: { getPreferences: () => ({}), setPreferences: () => undefined },
    pushSubscriptions: { save: () => undefined, remove: () => undefined },
    getVapidPublicKey: () => null,
    ...overrides,
  };
}

test('listApiKeys redacts secret values through the service boundary', () => {
  const service = createSettingsService(dependencies({
    apiKeys: {
      list: () => [{ id: 1, api_key: '1234567890-secret' }],
      create: () => ({}), remove: () => false, toggle: () => false,
    },
  }));
  assert.equal(service.listApiKeys(1).apiKeys[0]?.api_key, '1234567890...');
});

test('subscribeToPush persists the subscription and enables Web Push', () => {
  const operations: string[] = [];
  const service = createSettingsService(dependencies({
    pushSubscriptions: {
      save: (_id, endpoint) => operations.push(`save:${endpoint}`),
      remove: () => undefined,
    },
    notifications: {
      getPreferences: () => ({ channels: { webPush: false } }),
      updatePreferences: () => { operations.push('preferences'); return {}; },
      createEnabledEvent: () => ({ code: 'push.enabled' }),
      notifyUser: () => { operations.push('notify'); },
    },
  }));

  service.subscribeToPush(1, {
    endpoint: 'https://push.example.test',
    keys: { p256dh: 'key', auth: 'auth' },
  });
  assert.deepEqual(operations, ['save:https://push.example.test', 'preferences', 'notify']);
});

test('updateSyncedPreferences stores allowlisted keys and drops unknown ones', () => {
  const stored: Record<string, unknown>[] = [];
  const service = createSettingsService(dependencies({
    preferences: {
      getPreferences: () => ({}),
      setPreferences: (_userId, entries) => { stored.push(entries); },
    },
  }));

  service.updateSyncedPreferences(1, {
    thinkingMessages: ['Pondering'],
    thinkingMessageCycle: '2',
    authToken: 'stolen',
  });
  assert.deepEqual(stored, [{ thinkingMessages: ['Pondering'], thinkingMessageCycle: '2' }]);
});

test('updateSyncedPreferences keeps a null value so a reset deletes the stored row', () => {
  const stored: Record<string, unknown>[] = [];
  const service = createSettingsService(dependencies({
    preferences: {
      getPreferences: () => ({}),
      setPreferences: (_userId, entries) => { stored.push(entries); },
    },
  }));

  service.updateSyncedPreferences(1, { thinkingMessages: null });
  assert.deepEqual(stored, [{ thinkingMessages: null }]);
});

test('updateSyncedPreferences rejects a value past the size cap', () => {
  const service = createSettingsService(dependencies());
  assert.throws(
    () => service.updateSyncedPreferences(1, { thinkingMessages: ['x'.repeat(9000)] }),
    /too large/,
  );
});
