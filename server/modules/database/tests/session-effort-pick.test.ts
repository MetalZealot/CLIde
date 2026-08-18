import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import {
  readProviderSessionEffortPick,
  writeProviderSessionEffortPick,
} from '@/modules/providers/index.js';

async function withIsolatedDatabase(
  runTest: () => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-effort-pick-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

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

test('an effort pick round-trips through the sessions table', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');

    const written = await writeProviderSessionEffortPick('claude', {
      sessionId: 'app-1',
      effort: 'medium',
    });
    assert.equal(written.changed, true);
    assert.equal(written.effort, 'medium');
    assert.ok(written.updatedAt, 'a pick must record when it was made');

    const read = await readProviderSessionEffortPick('claude', 'app-1');
    assert.equal(read.changed, true);
    assert.equal(read.effort, 'medium');
    assert.equal(read.updatedAt, written.updatedAt);
  });
});

test('an explicit default choice is stored, not discarded', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('app-default', 'codex', '/workspace/demo');

    // "Default" is a deliberate choice — run this session with no effort
    // override — and has to survive a reload the way "high" does. Dropping it
    // would leave the session looking un-chosen and let a seed take over.
    const written = await writeProviderSessionEffortPick('codex', {
      sessionId: 'app-default',
      effort: 'default',
    });
    assert.equal(written.changed, true);
    assert.equal(written.effort, 'default');

    assert.equal((await readProviderSessionEffortPick('codex', 'app-default')).effort, 'default');
  });
});

test('two sessions hold their own effort', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('session-a', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('session-b', 'claude', '/workspace/demo');

    await writeProviderSessionEffortPick('claude', { sessionId: 'session-a', effort: 'medium' });
    await writeProviderSessionEffortPick('claude', { sessionId: 'session-b', effort: 'high' });

    assert.equal((await readProviderSessionEffortPick('claude', 'session-a')).effort, 'medium');
    assert.equal((await readProviderSessionEffortPick('claude', 'session-b')).effort, 'high');
  });
});

test('an effort pick is scoped to its own provider', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('app-2', 'claude', '/workspace/demo');

    await writeProviderSessionEffortPick('claude', { sessionId: 'app-2', effort: 'max' });

    // Same session id, different provider. Effort vocabularies differ — `max`
    // is a Claude level Codex cannot run — so Codex must neither read nor
    // overwrite this row.
    const codexRead = await readProviderSessionEffortPick('codex', 'app-2');
    assert.equal(codexRead.changed, false);
    assert.equal(codexRead.effort, null);

    const codexWrite = await writeProviderSessionEffortPick('codex', {
      sessionId: 'app-2',
      effort: 'high',
    });
    assert.equal(codexWrite.changed, false);

    assert.equal((await readProviderSessionEffortPick('claude', 'app-2')).effort, 'max');
  });
});

test('an effort pick for a session that has no row reports that nothing was stored', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();

    // A brand-new chat has no session row until its first send. Claiming
    // `changed: true` would report a pick that matched no row at all.
    const written = await writeProviderSessionEffortPick('claude', {
      sessionId: 'never-created',
      effort: 'high',
    });
    assert.equal(written.changed, false);
    assert.equal(written.effort, null);
  });
});

test('a provider without effort support neither reads nor writes a pick', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('cursor-1', 'cursor', '/workspace/demo');

    const written = await writeProviderSessionEffortPick('cursor', {
      sessionId: 'cursor-1',
      effort: 'high',
    });
    assert.equal(written.supported, false);
    assert.equal(written.changed, false);

    const read = await readProviderSessionEffortPick('cursor', 'cursor-1');
    assert.equal(read.supported, false);

    const row = getConnection()
      .prepare('SELECT effort FROM sessions WHERE session_id = ?')
      .get('cursor-1') as { effort: string | null };
    assert.equal(row.effort, null, 'an unsupported provider must not write the column');
  });
});

/**
 * Reproduces a database from before this change: rows exist, effort columns do
 * not. Built by dropping the columns rather than hand-writing an old schema, so
 * the fixture stays honest as the rest of the sessions table evolves.
 */
const dropEffortColumns = (): void => {
  const db = getConnection();
  db.exec('ALTER TABLE sessions DROP COLUMN effort');
  db.exec('ALTER TABLE sessions DROP COLUMN effort_updated_at');
};

test('the migration adds the effort columns to an existing database without touching its rows', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('upgrade-1', 'claude', '/workspace/demo');
    await writeProviderSessionEffortPick('claude', { sessionId: 'upgrade-1', effort: 'high' });
    sessionsDb.updateSessionCustomName('upgrade-1', 'Named before the upgrade');
    dropEffortColumns();
    closeConnection();

    await initializeDatabase();

    const columns = (getConnection().prepare('PRAGMA table_info(sessions)').all() as {
      name: string;
    }[]).map((column) => column.name);
    assert.ok(columns.includes('effort'), 'sessions.effort should exist');
    assert.ok(columns.includes('effort_updated_at'), 'sessions.effort_updated_at should exist');

    // The upgrade adds columns and imports nothing: effort had no per-session
    // home before this change, so a pre-existing session starts unchosen.
    const read = await readProviderSessionEffortPick('claude', 'upgrade-1');
    assert.equal(read.changed, false);
    assert.equal(sessionsDb.getSessionById('upgrade-1')?.custom_name, 'Named before the upgrade');
  });
});

test('an effort pick survives a restart', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('kept-1', 'codex', '/workspace/demo');
    await writeProviderSessionEffortPick('codex', { sessionId: 'kept-1', effort: 'xhigh' });
    closeConnection();

    await initializeDatabase();
    assert.equal((await readProviderSessionEffortPick('codex', 'kept-1')).effort, 'xhigh');
  });
});

test('the effort columns exist on a freshly created database', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    const columns = (getConnection().prepare('PRAGMA table_info(sessions)').all() as {
      name: string;
    }[]).map((column) => column.name);

    assert.ok(columns.includes('effort'), 'sessions.effort should exist');
    assert.ok(columns.includes('effort_updated_at'), 'sessions.effort_updated_at should exist');
  });
});
