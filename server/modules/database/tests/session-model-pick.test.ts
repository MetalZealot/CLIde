import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import {
  readProviderSessionModelPick,
  writeProviderSessionModelPick,
} from '@/modules/providers/index.js';

async function withIsolatedDatabase(
  runTest: (homeDirectory: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHome = process.env.HOME;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-model-pick-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  // The legacy sidecar import resolves its path from the home directory, so the
  // whole migration is exercised without touching the real ~/.cloudcli.
  process.env.HOME = tempDirectory;

  try {
    await runTest(tempDirectory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a session model pick round-trips through the sessions table', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');

    const written = await writeProviderSessionModelPick('claude', {
      sessionId: 'app-1',
      model: 'opus',
    });
    assert.equal(written.changed, true);
    assert.equal(written.model, 'opus');
    assert.ok(written.updatedAt, 'a pick must record when it was made');

    const read = await readProviderSessionModelPick('claude', 'app-1');
    assert.equal(read.changed, true);
    assert.equal(read.model, 'opus');
    assert.equal(read.updatedAt, written.updatedAt);
  });
});

test('a pick is scoped to its own provider', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('app-2', 'claude', '/workspace/demo');

    await writeProviderSessionModelPick('claude', { sessionId: 'app-2', model: 'opus' });

    // Same session id, different provider: the row belongs to Claude, so Codex
    // must not read Claude's model name — and must not overwrite it either.
    const codexRead = await readProviderSessionModelPick('codex', 'app-2');
    assert.equal(codexRead.changed, false);
    assert.equal(codexRead.model, null);

    const codexWrite = await writeProviderSessionModelPick('codex', {
      sessionId: 'app-2',
      model: 'gpt-5-codex',
    });
    assert.equal(codexWrite.changed, false);

    const claudeRead = await readProviderSessionModelPick('claude', 'app-2');
    assert.equal(claudeRead.model, 'opus');
  });
});

test('a pick for a session that has no row reports that nothing was stored', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();

    // A brand-new chat has no session row until its first send. Reporting
    // `changed: true` here would claim a pick had been persisted when the write
    // matched no row at all.
    const written = await writeProviderSessionModelPick('claude', {
      sessionId: 'never-created',
      model: 'opus',
    });
    assert.equal(written.changed, false);
    assert.equal(written.model, null);
  });
});

/**
 * Reproduces a pre-ADR-0025 database: rows exist, the model columns do not.
 * Building it this way (rather than hand-writing an old schema) keeps the
 * fixture honest as the rest of the sessions table evolves.
 */
const dropModelColumns = (): void => {
  const db = getConnection();
  db.exec('ALTER TABLE sessions DROP COLUMN model');
  db.exec('ALTER TABLE sessions DROP COLUMN model_updated_at');
};

const writeLegacySidecar = async (
  homeDirectory: string,
  entries: Record<string, unknown>,
): Promise<void> => {
  const cloudcliDirectory = path.join(homeDirectory, '.cloudcli');
  await mkdir(cloudcliDirectory, { recursive: true });
  await writeFile(
    path.join(cloudcliDirectory, 'provider-session-active-model-changes.json'),
    JSON.stringify({ version: 1, entries }),
    'utf8',
  );
};

test('picks from the pre-ADR-0025 sidecar file are imported on the upgrade', async () => {
  await withIsolatedDatabase(async (homeDirectory) => {
    await initializeDatabase();
    sessionsDb.createAppSession('legacy-1', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('legacy-2', 'codex', '/workspace/demo');
    sessionsDb.createAppSession('legacy-3', 'claude', '/workspace/demo');
    dropModelColumns();
    closeConnection();

    await writeLegacySidecar(homeDirectory, {
      'claude:legacy-1': {
        provider: 'claude',
        sessionId: 'legacy-1',
        supported: true,
        changed: true,
        model: 'fable',
        updatedAt: '2026-07-13T17:37:44.771Z',
      },
      // Provider mismatch: this entry names claude, but the row is codex.
      'claude:legacy-2': {
        provider: 'claude',
        sessionId: 'legacy-2',
        supported: true,
        changed: true,
        model: 'sonnet',
        updatedAt: '2026-07-13T17:37:44.771Z',
      },
      // A cleared pick carries changed: false and must not be imported.
      'claude:legacy-3': {
        provider: 'claude',
        sessionId: 'legacy-3',
        supported: true,
        changed: false,
        model: null,
        updatedAt: '2026-07-13T17:37:44.771Z',
      },
    });

    await initializeDatabase();

    const imported = await readProviderSessionModelPick('claude', 'legacy-1');
    assert.equal(imported.changed, true);
    assert.equal(imported.model, 'fable');
    assert.equal(imported.updatedAt, '2026-07-13T17:37:44.771Z');

    const mismatched = await readProviderSessionModelPick('codex', 'legacy-2');
    assert.equal(mismatched.changed, false);

    const cleared = await readProviderSessionModelPick('claude', 'legacy-3');
    assert.equal(cleared.changed, false);
  });
});

test('a pick made after the upgrade survives later restarts', async () => {
  await withIsolatedDatabase(async (homeDirectory) => {
    await initializeDatabase();
    sessionsDb.createAppSession('kept-1', 'claude', '/workspace/demo');
    dropModelColumns();
    closeConnection();

    await writeLegacySidecar(homeDirectory, {
      'claude:kept-1': {
        provider: 'claude',
        sessionId: 'kept-1',
        supported: true,
        changed: true,
        model: 'stale-sidecar-value',
        updatedAt: '2026-07-13T17:37:44.771Z',
      },
    });

    // Upgrade imports the sidecar value, then the user picks something else.
    await initializeDatabase();
    assert.equal((await readProviderSessionModelPick('claude', 'kept-1')).model, 'stale-sidecar-value');
    await writeProviderSessionModelPick('claude', { sessionId: 'kept-1', model: 'opus' });
    closeConnection();

    // The sidecar is still on disk (the migration never deletes it), so a
    // restart must not resurrect the value the user just replaced.
    await initializeDatabase();
    assert.equal((await readProviderSessionModelPick('claude', 'kept-1')).model, 'opus');
  });
});

test('the new columns exist on a freshly created database', async () => {
  await withIsolatedDatabase(async () => {
    await initializeDatabase();
    const columns = (getConnection().prepare('PRAGMA table_info(sessions)').all() as {
      name: string;
    }[]).map((column) => column.name);

    assert.ok(columns.includes('model'), 'sessions.model should exist');
    assert.ok(columns.includes('model_updated_at'), 'sessions.model_updated_at should exist');
  });
});
