import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-mapping-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('disk-discovered sessions are keyed by the provider id for both columns', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('provider-abc', 'claude', '/workspace/demo', 'From Disk');

    const row = sessionsDb.getSessionById('provider-abc');
    assert.equal(row?.session_id, 'provider-abc');
    assert.equal(row?.provider_session_id, 'provider-abc');

    const byProviderId = sessionsDb.getSessionByProviderSessionId('provider-abc');
    assert.equal(byProviderId?.session_id, 'provider-abc');
  });
});

test('app sessions get the provider id assigned without creating a duplicate row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-id-1', 'provider-xyz');

    // A later synchronizer pass that discovers the transcript on disk must
    // update the app row in place instead of inserting a provider-keyed row.
    const returnedId = sessionsDb.createSession(
      'provider-xyz',
      'claude',
      '/workspace/demo',
      'Synced Name',
      undefined,
      undefined,
      '/fake/path/provider-xyz.jsonl',
    );

    assert.equal(returnedId, 'app-id-1');
    assert.equal(sessionsDb.getAllSessions().length, 1);

    const row = sessionsDb.getSessionById('app-id-1');
    assert.equal(row?.provider_session_id, 'provider-xyz');
    assert.equal(row?.jsonl_path, '/fake/path/provider-xyz.jsonl');
  });
});

test('assignProviderSessionId merges a watcher-created duplicate into the app row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-2', 'codex', '/workspace/demo');

    // Simulate the race: the filesystem watcher indexed the provider
    // transcript before the runtime announced its session id to the gateway.
    sessionsDb.createSession(
      'provider-race',
      'codex',
      '/workspace/demo',
      'Watcher Name',
      undefined,
      undefined,
      '/fake/provider-race.jsonl',
    );
    assert.equal(sessionsDb.getAllSessions().length, 2);

    sessionsDb.assignProviderSessionId('app-id-2', 'provider-race');

    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-id-2');
    assert.equal(rows[0]?.provider_session_id, 'provider-race');
    // Transcript path and name from the duplicate are adopted.
    assert.equal(rows[0]?.jsonl_path, '/fake/provider-race.jsonl');
    assert.equal(rows[0]?.custom_name, 'Watcher Name');
  });
});

test('reassigning a provider id aliases the superseded transcript instead of resurrecting it', async () => {
  await withIsolatedDatabase(() => {
    // A rewind of the first message starts a fresh provider session: the app
    // row moves from the old provider id to a new one, while the old
    // transcript stays on disk.
    sessionsDb.createAppSession('app-rewind', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-rewind', 'provider-old');
    sessionsDb.assignProviderSessionId('app-rewind', 'provider-new');

    assert.equal(sessionsDb.getSessionById('app-rewind')?.provider_session_id, 'provider-new');

    // The synchronizer later discovers the abandoned transcript. It must be
    // treated as claimed by the app row — no duplicate, no field updates.
    const returnedId = sessionsDb.createSession(
      'provider-old',
      'claude',
      '/workspace/demo',
      'Stale Title',
      undefined,
      undefined,
      '/fake/provider-old.jsonl',
    );

    assert.equal(returnedId, 'app-rewind');
    assert.equal(sessionsDb.getAllSessions().length, 1);

    const row = sessionsDb.getSessionById('app-rewind');
    assert.equal(row?.provider_session_id, 'provider-new');
    assert.equal(row?.custom_name, null);
    assert.equal(row?.jsonl_path, null);
  });
});

test('a provider id assigned to a new session stops being a tombstone', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-first', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-first', 'provider-shared');
    sessionsDb.assignProviderSessionId('app-first', 'provider-moved');

    // The provider reuses the old id for a different app session: the alias
    // must yield to the live mapping.
    sessionsDb.createAppSession('app-second', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-second', 'provider-shared');

    const returnedId = sessionsDb.createSession('provider-shared', 'claude', '/workspace/demo');
    assert.equal(returnedId, 'app-second');
  });
});

test('a discovered transcript never clobbers an app row whose mapping moved elsewhere', async () => {
  await withIsolatedDatabase(() => {
    // Pre-aliases-table shape (or an app id colliding with a jsonl name): a
    // row keyed by the old provider id already points at a newer provider id.
    sessionsDb.createAppSession('provider-stale', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('provider-stale', 'provider-current');

    const returnedId = sessionsDb.createSession(
      'provider-stale',
      'claude',
      '/workspace/demo',
      'Resurrected Title',
      undefined,
      undefined,
      '/fake/provider-stale.jsonl',
    );

    assert.equal(returnedId, 'provider-stale');
    assert.equal(sessionsDb.getAllSessions().length, 1);
    // The ON CONFLICT(session_id) upsert must not have rewritten the mapping.
    const row = sessionsDb.getSessionById('provider-stale');
    assert.equal(row?.provider_session_id, 'provider-current');
    assert.equal(row?.jsonl_path, null);
  });
});

test('legacy provider-keyed rows stay resolvable through both lookups', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('legacy-1', 'opencode', '/workspace/demo');

    assert.equal(sessionsDb.getSessionById('legacy-1')?.provider, 'opencode');
    assert.equal(sessionsDb.getSessionByProviderSessionId('legacy-1')?.session_id, 'legacy-1');
  });
});
