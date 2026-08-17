// Cross-provider session records: listing, detail lookup, starring.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

describe('claude-sessions', () => {
  const SESSION_ID = 'session-1';

  const SKILL_BODY = [
    'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
    '',
    '# Building LLM-Powered Applications with Claude',
    '',
    'This skill helps you build LLM-powered applications with Claude.',
  ].join('\n');

  test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
    const provider = new ClaudeSessionsProvider();

    // The live SDK stream omits `isMeta`, so the payload has to be recognised by
    // its content or it renders as a giant user bubble mid-run.
    const live = provider.normalizeMessage(
      {
        uuid: 'u1',
        timestamp: '2026-07-28T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
      },
      SESSION_ID,
    );
    assert.deepEqual(live, []);

    const persisted = provider.normalizeMessage(
      {
        uuid: 'u2',
        timestamp: '2026-07-28T10:00:00.000Z',
        isMeta: true,
        message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
      },
      SESSION_ID,
    );
    assert.deepEqual(persisted, []);
  });

  test('claude: the Skill tool result itself still reaches the UI', () => {
    const provider = new ClaudeSessionsProvider();

    const messages = provider.normalizeMessage(
      {
        uuid: 'u3',
        timestamp: '2026-07-28T10:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
        },
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'tool_result');
    assert.equal(messages[0].toolId, 'toolu_1');
  });
});

describe('sessions-details', () => {
  async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-details-'));
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

  test('getSessionDetailsById resolves the owning project for a disk-indexed session', async () => {
    await withIsolatedDatabase(() => {
      const projectPath = '/home/user/example-project';
      const sessionId = sessionsDb.createSession('provider-abc', 'claude', projectPath, 'My session');
      const projectRow = projectsDb.getProjectPath(projectPath);
      assert.ok(projectRow, 'project row should exist after createSession');

      const details = sessionsService.getSessionDetailsById(sessionId);

      assert.equal(details.sessionId, sessionId);
      assert.equal(details.provider, 'claude');
      assert.equal(details.summary, 'My session');
      assert.equal(details.isArchived, false);
      assert.ok(details.project, 'project should be resolved');
      assert.equal(details.project?.projectId, projectRow?.project_id);
      // Paths are normalized to platform separators when stored.
      assert.equal(details.project?.fullPath, normalizeProjectPath(projectPath));
    });
  });

  test('getSessionDetailsById falls back to the provider-native id and returns the canonical app id', async () => {
    await withIsolatedDatabase(() => {
      const projectPath = '/home/user/alias-project';
      const appSessionId = sessionsDb.createAppSession('app-session-1', 'claude', projectPath);
      sessionsDb.assignProviderSessionId(appSessionId, 'provider-native-1');

      const details = sessionsService.getSessionDetailsById('provider-native-1');

      assert.equal(details.sessionId, appSessionId);
      assert.equal(details.project?.fullPath, normalizeProjectPath(projectPath));
    });
  });

  test('getSessionDetailsById throws SESSION_NOT_FOUND for unknown ids', async () => {
    await withIsolatedDatabase(() => {
      assert.throws(
        () => sessionsService.getSessionDetailsById('does-not-exist'),
        (error: unknown) => error instanceof AppError && error.code === 'SESSION_NOT_FOUND',
      );
    });
  });
});

describe('session-star', () => {
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
});
