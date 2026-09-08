import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import {
  readProviderSessionEffortPick,
  readProviderSessionModelPick,
  writeProviderSessionEffortPick,
  writeProviderSessionModelPick,
} from '@/modules/providers/index.js';

describe('sessions.db.integration', () => {
  async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
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

  test('session archive queries hide archived rows from active project views', async () => {
    await withIsolatedDatabase(() => {
      sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
      sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
      sessionsDb.updateSessionIsArchived('session-archived', true);

      const activeSessions = sessionsDb.getAllSessions();
      const archivedSessions = sessionsDb.getArchivedSessions();
      const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
      const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

      assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
      assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
      assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
      assert.deepEqual(
        allProjectSessions.map((session) => session.session_id).sort(),
        ['session-active', 'session-archived'],
      );
      assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
    });
  });

  test('createSession reactivates archived rows when the session becomes active again', async () => {
    await withIsolatedDatabase(() => {
      sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
      sessionsDb.updateSessionIsArchived('session-reused', true);

      sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

      const activeSessions = sessionsDb.getAllSessions();
      const archivedSessions = sessionsDb.getArchivedSessions();
      const restoredSession = sessionsDb.getSessionById('session-reused');

      assert.equal(activeSessions.length, 1);
      assert.equal(activeSessions[0]?.session_id, 'session-reused');
      assert.equal(activeSessions[0]?.custom_name, 'Updated Name');
      assert.equal(archivedSessions.length, 0);
      assert.equal(restoredSession?.isArchived, 0);
    });
  });

  test('createSession leaves an archived row archived when the transcript has not changed', async () => {
    await withIsolatedDatabase(() => {
      const createdAt = '2026-07-18T09:00:00.000Z';
      const updatedAt = '2026-07-18T10:00:00.000Z';
      const jsonlPath = '/transcripts/session-untouched.jsonl';

      sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, updatedAt, jsonlPath);
      sessionsDb.updateSessionIsArchived('session-untouched', true);

      // A full rescan re-indexes every transcript created since the last scan,
      // changed or not, and hands over the timestamps the file still carries.
      sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, updatedAt, jsonlPath);

      assert.equal(sessionsDb.getSessionById('session-untouched')?.isArchived, 1);
      assert.equal(sessionsDb.getArchivedSessions().length, 1);
      assert.equal(sessionsDb.getAllSessions().length, 0);

      // Actually writing to the session again still brings it back.
      sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, '2026-07-18T11:00:00.000Z', jsonlPath);

      assert.equal(sessionsDb.getSessionById('session-untouched')?.isArchived, 0);
    });
  });

  test('the upsert path counts an omitted timestamp as activity', async () => {
    await withIsolatedDatabase(() => {
      // An app-created row carries no provider id, so indexing it takes the
      // INSERT ... ON CONFLICT branch rather than the UPDATE above. Its
      // updated_at is CURRENT_TIMESTAMP, which resolves to whole seconds, so a
      // call in the same second is not *newer* - the omitted timestamp itself
      // has to be what reactivates the row.
      sessionsDb.createAppSession('session-legacy', 'claude', '/workspace/demo-project');
      sessionsDb.updateSessionIsArchived('session-legacy', true);

      sessionsDb.createSession('session-legacy', 'claude', '/workspace/demo-project', 'Indexed Name');

      assert.equal(sessionsDb.getSessionById('session-legacy')?.isArchived, 0);
    });
  });

  test('the upsert path leaves an archived row alone for a transcript older than it', async () => {
    await withIsolatedDatabase(() => {
      sessionsDb.createAppSession('session-stale', 'claude', '/workspace/demo-project');
      sessionsDb.updateSessionIsArchived('session-stale', true);

      sessionsDb.createSession('session-stale', 'claude', '/workspace/demo-project', 'Indexed Name', '2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z', '/transcripts/session-stale.jsonl');

      assert.equal(sessionsDb.getSessionById('session-stale')?.isArchived, 1);
    });
  });

  test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
    await withIsolatedDatabase(() => {
      sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

      const row = sessionsDb.getSessionById('session-timezone');
      assert.ok(row?.created_at.endsWith('Z'));
      assert.ok(row?.updated_at.endsWith('Z'));
      assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe('sessions-provider-mapping', () => {
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
});

describe('session-effort-pick', () => {
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
});

describe('session-model-pick', () => {
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
});
