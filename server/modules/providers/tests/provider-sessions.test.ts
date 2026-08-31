import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { encodeClaudeProjectDir } from '@/modules/providers/list/claude/claude-rewind.util.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CodexSessionsProvider, extractCodexUserImages } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/image-attachments.js';
import { AppError, normalizeProjectPath, readLastJsonlTimestamp } from '@/shared/utils.js';

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

describe('session-activity-timestamp', () => {
  const claudeRowTimestamp = (row: unknown): string | null => {
    const parsed = row as Record<string, unknown>;
    return typeof parsed?.timestamp === 'string' ? parsed.timestamp : null;
  };

  const cursorRowTimestamp = (row: unknown): string | null => {
    const parsed = row as { message?: { content?: Array<{ text?: unknown }> } };
    const text = parsed?.message?.content?.[0]?.text;
    if (typeof text !== 'string') {
      return null;
    }
    return /<timestamp>([\s\S]*?)<\/timestamp>/.exec(text)?.[1]?.trim() ?? null;
  };

  async function withTranscript(
    lines: string[],
    runTest: (filePath: string) => Promise<void>,
  ): Promise<void> {
    const directory = await mkdtemp(path.join(tmpdir(), 'session-activity-'));
    const filePath = path.join(directory, 'transcript.jsonl');
    try {
      await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
      await runTest(filePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  test('a touched transcript keeps the timestamp of its last message', async () => {
    const rows = [
      JSON.stringify({ sessionId: 's1', cwd: '/tmp', timestamp: '2026-08-01T10:00:00.000Z' }),
      JSON.stringify({ sessionId: 's1', cwd: '/tmp', timestamp: '2026-08-02T11:30:00.000Z' }),
    ];

    await withTranscript(rows, async (filePath) => {
      assert.equal(
        await readLastJsonlTimestamp(filePath, claudeRowTimestamp),
        '2026-08-02T11:30:00.000Z',
      );

      // The defect this replaces: mtime moves, the conversation does not.
      const future = new Date('2026-09-15T09:00:00.000Z');
      await utimes(filePath, future, future);
      assert.equal(
        await readLastJsonlTimestamp(filePath, claudeRowTimestamp),
        '2026-08-02T11:30:00.000Z',
      );
    });
  });

  test('a last row larger than the first window is still found', async () => {
    const rows = [
      JSON.stringify({ timestamp: '2026-08-01T10:00:00.000Z' }),
      JSON.stringify({ timestamp: '2026-08-03T08:00:00.000Z', bulk: 'x'.repeat(4096) }),
    ];

    await withTranscript(rows, async (filePath) => {
      assert.equal(
        await readLastJsonlTimestamp(filePath, claudeRowTimestamp, 512),
        '2026-08-03T08:00:00.000Z',
      );
    });
  });

  test('rows without a usable timestamp fall through to the caller', async () => {
    const rows = [
      JSON.stringify({ timestamp: '2026-08-01T10:00:00.000Z' }),
      JSON.stringify({ timestamp: 'not-a-date' }),
      'this line is not json',
    ];

    await withTranscript(rows, async (filePath) => {
      assert.equal(
        await readLastJsonlTimestamp(filePath, claudeRowTimestamp),
        '2026-08-01T10:00:00.000Z',
      );
    });

    await withTranscript([JSON.stringify({ role: 'user' })], async (filePath) => {
      assert.equal(await readLastJsonlTimestamp(filePath, claudeRowTimestamp), null);
    });
  });

  test('cursor turns carry their timestamp inside the message text', async () => {
    const rows = [
      JSON.stringify({
        role: 'user',
        message: { content: [{ text: '<timestamp>2026-08-04T07:15:00.000Z</timestamp><user_query>hi</user_query>' }] },
      }),
    ];

    await withTranscript(rows, async (filePath) => {
      assert.equal(
        await readLastJsonlTimestamp(filePath, cursorRowTimestamp),
        '2026-08-04T07:15:00.000Z',
      );
    });
  });
});

describe('session-working-directory', () => {
  const patchHomeDir = (nextHomeDir: string) => {
    const original = os.homedir;
    (os as any).homedir = () => nextHomeDir;
    return () => {
      (os as any).homedir = original;
    };
  };

  async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-session-cwd-db-'));

    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

  /**
   * Writes a Claude transcript into the encoded folder for `startedIn`, which
   * is where Claude keeps it for the session's whole life, and gives each row
   * the cwd the session had at that point.
   */
  async function withMovedSessionTranscript(
    cwdPerRow: string[],
    runTest: (context: { transcriptPath: string; homeDir: string }) => Promise<void>,
  ): Promise<void> {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-session-cwd-'));
    const startedIn = cwdPerRow[0]!;
    const projectDirectory = path.join(
      tempRoot, '.claude', 'projects', encodeClaudeProjectDir(startedIn),
    );
    await mkdir(projectDirectory, { recursive: true });

    const transcriptPath = path.join(projectDirectory, 'provider-1.jsonl');
    const rows = cwdPerRow.map((cwd, index) => JSON.stringify({
      sessionId: 'provider-1',
      cwd,
      timestamp: new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString(),
    }));
    await writeFile(transcriptPath, `${rows.join('\n')}\n`, 'utf8');

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await runTest({ transcriptPath, homeDir: tempRoot });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  test('a session that moves to a worktree is indexed there, not where it started', { concurrency: false }, async () => {
    const mainCheckout = path.join(tmpdir(), 'cwd-repo');
    const worktree = path.join(tmpdir(), 'cwd-repo-wt-feature');

    await withMovedSessionTranscript([mainCheckout, mainCheckout, worktree], async ({ transcriptPath }) => {
      await withIsolatedDatabase(async () => {
        sessionsDb.createAppSession('app-1', 'claude', mainCheckout);
        sessionsDb.assignProviderSessionId('app-1', 'provider-1');

        await new ClaudeSessionSynchronizer().synchronizeFile(transcriptPath);

        assert.equal(
          sessionsDb.getSessionById('app-1')?.project_path,
          normalizeProjectPath(worktree),
        );
      });
    });
  });

  test('a session that never moves keeps the directory it started in', { concurrency: false }, async () => {
    const mainCheckout = path.join(tmpdir(), 'cwd-repo');

    await withMovedSessionTranscript([mainCheckout, mainCheckout], async ({ transcriptPath }) => {
      await withIsolatedDatabase(async () => {
        sessionsDb.createAppSession('app-2', 'claude', mainCheckout);
        sessionsDb.assignProviderSessionId('app-2', 'provider-1');

        await new ClaudeSessionSynchronizer().synchronizeFile(transcriptPath);

        assert.equal(
          sessionsDb.getSessionById('app-2')?.project_path,
          normalizeProjectPath(mainCheckout),
        );
      });
    });
  });
});

describe('claude-subagent-history', () => {
  async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-subagent-db-'));
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

  const PROVIDER_SESSION_ID = 'provider-subagent-1';

  function parentTranscript(): string {
    return [
      JSON.stringify({
        uuid: 'a1',
        parentUuid: null,
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:00.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_task',
            name: 'Task',
            input: { description: 'Review the diff', subagent_type: 'code-reviewer' },
          }],
        },
      }),
      JSON.stringify({
        uuid: 'a2',
        parentUuid: 'a1',
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:01:00.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'Review complete' }],
        },
        toolUseResult: { agentId: 'ab12' },
      }),
    ].join('\n') + '\n';
  }

  test('a finished Task picks its child tools up from the nested subagents directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-subagent-'));
    const transcriptPath = path.join(tempRoot, `${PROVIDER_SESSION_ID}.jsonl`);
    const subagentDir = path.join(tempRoot, PROVIDER_SESSION_ID, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    await writeFile(transcriptPath, parentTranscript(), 'utf8');
    await writeFile(path.join(subagentDir, 'agent-ab12.jsonl'), [
      JSON.stringify({
        uuid: 's1',
        isSidechain: true,
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:30.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'TODO' } }],
        },
      }),
      JSON.stringify({
        uuid: 's2',
        isSidechain: true,
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:40.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_grep', content: 'three hits' }],
        },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          PROVIDER_SESSION_ID,
          'claude',
          path.join(tempRoot, 'workspace'),
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );

        const history = await new ClaudeSessionsProvider().fetchHistory(PROVIDER_SESSION_ID);
        const task = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolName === 'Task',
        );

        assert.ok(task, 'the Task tool call should be in history');
        const childTools = task.subagentTools as Array<{
          toolName: string;
          toolResult?: { content?: string };
        }>;
        assert.deepEqual(childTools.map((tool) => tool.toolName), ['Grep']);
        assert.equal(childTools[0].toolResult?.content, 'three hits');
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('a session that has never forked an agent loads without a subagents directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-subagent-none-'));
    const transcriptPath = path.join(tempRoot, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeFile(transcriptPath, parentTranscript(), 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          PROVIDER_SESSION_ID,
          'claude',
          path.join(tempRoot, 'workspace'),
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );

        const history = await new ClaudeSessionsProvider().fetchHistory(PROVIDER_SESSION_ID);
        const task = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolName === 'Task',
        );

        assert.ok(task, 'history should still load');
        assert.equal(task.subagentTools, undefined);
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
