import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CodexSessionsProvider, extractCodexUserImages } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/image-attachments.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

describe('provider-sessions', () => {
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
});

describe('provider-attachment-history', () => {
  const SESSION_ID = 'session-1';

  // ---------------------------------------------------------------- Claude

  test('claude history: base64 image blocks surface as user message images', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'u1',
      timestamp: '2026-07-03T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this screenshot?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'REVG' } },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'text');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'What is in this screenshot?');
    assert.deepEqual(messages[0].images, [
      { data: 'data:image/png;base64,QUJD' },
      { data: 'data:image/jpeg;base64,REVG' },
    ]);
  });

  test('claude history: image-only user turns still produce a bubble', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'u2',
      timestamp: '2026-07-03T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, '');
    assert.deepEqual(messages[0].images, [{ data: 'data:image/png;base64,QUJD' }]);
  });

  test('claude history: plain text user turns carry no images field', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'u3',
      timestamp: '2026-07-03T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].images, undefined);
  });

  test('claude history: file reference blocks restore non-image attachments', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'u4',
      timestamp: '2026-07-03T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: appendFilesInputTag('Summarize this', [
            { path: 'C:/Users/x/.cloudcli/assets/brief.pdf', name: 'brief.pdf' },
          ]),
        }],
      },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);
    assert.equal(messages[0].content, 'Summarize this');
    assert.deepEqual(messages[0].files, [
      { path: 'C:/Users/x/.cloudcli/assets/brief.pdf', name: 'brief.pdf' },
    ]);
  });

  // ---------------------------------------------------------------- Codex

  test('codex history: user_message payload images become path attachments', () => {
    // Real rollout shape: local_image input items land in `local_images`,
    // while `images` stays an empty array.
    assert.deepEqual(
      extractCodexUserImages({
        type: 'user_message',
        message: 'can u see attached image?',
        images: [],
        local_images: ['C:\\proj\\.cloudcli\\assets\\a.png'],
      }),
      [{ path: 'C:/proj/.cloudcli/assets/a.png' }],
    );
    assert.deepEqual(
      extractCodexUserImages({ type: 'user_message', message: 'hi', images: ['/proj/b.jpg'] }),
      [{ path: '/proj/b.jpg' }],
    );
    assert.equal(extractCodexUserImages({ type: 'user_message', message: 'hi' }), undefined);
    assert.equal(extractCodexUserImages({ type: 'user_message', message: 'hi', images: [], local_images: [] }), undefined);
  });

  test('codex history: base64 data URLs pass through as inline data attachments', () => {
    const dataUrl = 'data:image/png;base64,QUJD';
    assert.deepEqual(
      extractCodexUserImages({
        type: 'user_message',
        message: 'look',
        images: [dataUrl],
        local_images: ['C:\\proj\\a.png'],
      }),
      [{ path: 'C:/proj/a.png' }, { data: dataUrl }],
    );
  });

  test('codex history: normalized user entries keep their images', () => {
    const provider = new CodexSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        timestamp: '2026-07-03T10:00:00.000Z',
        message: { role: 'user', content: 'Look at this' },
        images: [{ path: '.cloudcli/assets/a.png' }],
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'Look at this');
    assert.deepEqual(messages[0].images, [{ path: '.cloudcli/assets/a.png' }]);
  });

  test('codex history: normalized user entries restore file reference blocks', () => {
    const provider = new CodexSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        timestamp: '2026-07-03T10:00:00.000Z',
        message: {
          role: 'user',
          content: appendFilesInputTag('Review this', [
            { path: 'C:/Users/x/.cloudcli/assets/spec.docx', name: 'spec.docx' },
          ]),
        },
      },
      SESSION_ID,
    );

    assert.equal(messages[0].content, 'Review this');
    assert.deepEqual(messages[0].files, [
      { path: 'C:/Users/x/.cloudcli/assets/spec.docx', name: 'spec.docx' },
    ]);
  });

  // ---------------------------------------------------------------- Cursor

  test('cursor history: <images_input> inside user_query is stripped and attached', () => {
    const provider = new CursorSessionsProvider();
    const taggedPrompt = appendImagesInputTag('Fix the layout bug', [{ path: '.cloudcli/assets/shot.png' }]);
    const blobs = [
      {
        id: 'blob1',
        sequence: 1,
        rowid: 1,
        content: {
          role: 'user',
          content: `<timestamp>2026-07-03</timestamp>\n<user_query>${taggedPrompt}</user_query>`,
        },
      },
      {
        id: 'blob2',
        sequence: 2,
        rowid: 2,
        content: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done — the flex container was wrong.' }],
        },
      },
    ];

    const messages = provider.normalizeCursorBlobs(blobs, SESSION_ID);

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'Fix the layout bug');
    assert.deepEqual(messages[0].images, [{ path: '.cloudcli/assets/shot.png' }]);
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].images, undefined);
  });

  test('cursor history: user text without a tag keeps existing behavior', () => {
    const provider = new CursorSessionsProvider();
    const blobs = [
      {
        id: 'blob1',
        sequence: 1,
        rowid: 1,
        content: {
          role: 'user',
          content: '<timestamp>2026-07-03</timestamp>\n<user_query>plain question</user_query>',
        },
      },
    ];

    const messages = provider.normalizeCursorBlobs(blobs, SESSION_ID);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'plain question');
    assert.equal(messages[0].images, undefined);
  });

  test('cursor history: file reference blocks are stripped and attached', () => {
    const provider = new CursorSessionsProvider();
    const taggedPrompt = appendFilesInputTag('Check the data', [
      { path: 'C:/Users/x/.cloudcli/assets/data.csv', name: 'data.csv' },
    ]);
    const messages = provider.normalizeCursorBlobs([
      {
        id: 'blob-file',
        sequence: 1,
        rowid: 1,
        content: {
          role: 'user',
          content: `<user_query>${taggedPrompt}</user_query>`,
        },
      },
    ], SESSION_ID);

    assert.equal(messages[0].content, 'Check the data');
    assert.deepEqual(messages[0].files, [
      { path: 'C:/Users/x/.cloudcli/assets/data.csv', name: 'data.csv' },
    ]);
  });
});
