import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
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
    favoriteModels: [{ provider: 'claude', model: 'opus' }],
    'codex-settings': { skipPermissions: false },
    authToken: 'stolen',
    thinkingMessages: ['retired key'],
  });
  assert.deepEqual(stored, [{
    favoriteModels: [{ provider: 'claude', model: 'opus' }],
    'codex-settings': { skipPermissions: false },
  }]);
});

test('updateSyncedPreferences keeps a null value so a reset deletes the stored row', () => {
  const stored: Record<string, unknown>[] = [];
  const service = createSettingsService(dependencies({
    preferences: {
      getPreferences: () => ({}),
      setPreferences: (_userId, entries) => { stored.push(entries); },
    },
  }));

  service.updateSyncedPreferences(1, { favoriteModels: null });
  assert.deepEqual(stored, [{ favoriteModels: null }]);
});

test('updateSyncedPreferences rejects a value past the size cap', () => {
  const service = createSettingsService(dependencies());
  assert.throws(
    () => service.updateSyncedPreferences(1, { favoriteModels: ['x'.repeat(9000)] }),
    /too large/,
  );
});
