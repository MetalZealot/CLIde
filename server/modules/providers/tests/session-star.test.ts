import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-star-db-'));
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

test('toggleSessionStarById flips the flag and round-trips through the DB', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const workspacePath = path.join(os.tmpdir(), 'star-workspace');
    sessionsDb.createAppSession('app-star-1', 'claude', workspacePath);

    assert.equal(Boolean(sessionsDb.getSessionById('app-star-1')?.isStarred), false);

    const first = sessionsService.toggleSessionStarById('app-star-1');
    assert.deepEqual(first, { sessionId: 'app-star-1', isStarred: true });
    assert.equal(Boolean(sessionsDb.getSessionById('app-star-1')?.isStarred), true);

    const second = sessionsService.toggleSessionStarById('app-star-1');
    assert.deepEqual(second, { sessionId: 'app-star-1', isStarred: false });
    assert.equal(Boolean(sessionsDb.getSessionById('app-star-1')?.isStarred), false);
  });
});

test('toggleSessionStarById throws a 404 for an unknown session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    assert.throws(
      () => sessionsService.toggleSessionStarById('does-not-exist'),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
    );
  });
});

test('starred sessions float to the top of the active project page', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const workspacePath = path.join(os.tmpdir(), 'star-ordering-workspace');

    // Explicit timestamps make recency ordering deterministic: `newer` sorts
    // first on activity alone, so starring `older` proves star-first wins.
    sessionsDb.createSession('older', 'claude', workspacePath, undefined, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    sessionsDb.createSession('newer', 'claude', workspacePath, undefined, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');

    const beforeStar = sessionsDb
      .getSessionsByProjectPathPage(workspacePath, 50, 0)
      .map((row) => row.session_id);
    assert.deepEqual(beforeStar, ['newer', 'older']);

    // Star the older session; it should now sort ahead of the newer one.
    sessionsDb.updateSessionIsStarred('older', true);

    const afterStar = sessionsDb
      .getSessionsByProjectPathPage(workspacePath, 50, 0)
      .map((row) => row.session_id);
    assert.deepEqual(afterStar, ['older', 'newer']);
  });
});
