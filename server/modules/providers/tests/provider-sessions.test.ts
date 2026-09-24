import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp, { appendFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { encodeClaudeProjectDir } from '@/modules/providers/list/claude/claude-rewind.util.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CodexSessionsProvider, extractCodexUserImages } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import {
  createSessionHistoryCache,
  sessionHistoryCache,
} from '@/modules/providers/services/session-history-cache.service.js';
import { paginateHistory } from '@/modules/providers/services/history-pagination.service.js';
import { measureHistoryMessage, slimHistoryMessage } from '@/modules/providers/services/history-payload.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/image-attachments.js';
import type { FetchHistoryResult, HistorySourceRevision, NormalizedMessage } from '@/shared/types.js';
import { AppError, normalizeProjectPath, readLastJsonlTimestamp } from '@/shared/utils.js';

import { historyBudgets } from '../../../../scripts/chat-history/budgets.js';

const legacyPage = ({ nextCursor: _cursor, revision: _revision, recordTotal: _records, ...page }: FetchHistoryResult) => page;

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

    test('claude: a side-question fork copies the transcript and appends the exchange as a normal turn', { concurrency: false }, async () => {
      const home = await mkdtemp(path.join(tmpdir(), 'claude-btw-fork-'));
      const projectPath = path.join(home, 'project');
      const projectDir = path.join(home, '.claude', 'projects', encodeClaudeProjectDir(projectPath));
      const sourceId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
      await mkdir(projectDir, { recursive: true });
      const base = { sessionId: sourceId, cwd: projectPath, userType: 'external', entrypoint: 'sdk-ts', version: '2.1.280', isSidechain: false };
      await writeFile(path.join(projectDir, `${sourceId}.jsonl`), [
        { ...base, type: 'user', uuid: 'aaaaaaaa-0000-4000-8000-000000000001', parentUuid: null, timestamp: '2026-09-23T12:00:00.000Z', message: { role: 'user', content: 'Main question' } },
        { ...base, type: 'assistant', uuid: 'aaaaaaaa-0000-4000-8000-000000000002', parentUuid: 'aaaaaaaa-0000-4000-8000-000000000001', timestamp: '2026-09-23T12:00:01.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Main answer' }], usage: { input_tokens: 10, output_tokens: 2 } } },
      ].map((row) => JSON.stringify(row)).join('\n') + '\n');

      const originalHomedir = os.homedir;
      const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
      (os as any).homedir = () => home;
      process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
      try {
        const provider = new ClaudeSessionsProvider();
        const fork = await provider.forkSession(sourceId, {
          projectPath,
          title: 'btw: which file?',
          appendExchange: { question: 'Which file?', response: 'server/index.ts' },
        });
        assert.notEqual(fork.providerSessionId, sourceId);
        const rows = (await readFile(fork.jsonlPath as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        const turns = rows.filter((row) => row.type === 'user' || row.type === 'assistant');
        const [question, answer] = turns.slice(-2);
        assert.equal(turns.length, 4, 'the main conversation is copied, then the exchange');
        assert.equal(question.message.content, 'Which file?');
        assert.equal(question.parentUuid, turns[1].uuid);
        assert.equal(answer.parentUuid, question.uuid);
        assert.equal(answer.sessionId, fork.providerSessionId);
        assert.equal(answer.message.usage.input_tokens, 0, 'zero usage keeps it out of the context ring');
        assert.ok(rows.some((row) => row.type === 'custom-title' && row.customTitle === 'btw: which file?'));

        const [rendered] = provider.normalizeMessage(answer, SESSION_ID);
        assert.equal(rendered.content, 'server/index.ts');
        assert.equal(rendered.isSystemNotice, undefined, 'renders as a reply, not a muted notice');
      } finally {
        (os as any).homedir = originalHomedir;
        if (previousConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
        }
        await rm(home, { recursive: true, force: true });
      }
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

  /** Writes a transcript whose later rows may execute outside its starting checkout. */
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

  test('later cwd rows cannot move a session away from its starting checkout', { concurrency: false }, async () => {
    const mainCheckout = path.join(tmpdir(), 'cwd-repo');
    const worktree = path.join(tmpdir(), 'cwd-repo-wt-feature');

    await withMovedSessionTranscript([mainCheckout, mainCheckout, worktree], async ({ transcriptPath }) => {
      await withIsolatedDatabase(async () => {
        sessionsDb.createAppSession('app-1', 'claude', mainCheckout);
        sessionsDb.assignProviderSessionId('app-1', 'provider-1');

        await new ClaudeSessionSynchronizer().synchronizeFile(transcriptPath);

        assert.equal(
          sessionsDb.getSessionById('app-1')?.project_path,
          normalizeProjectPath(mainCheckout),
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
        assert.equal(task.timestamp, '2026-08-31T10:00:00.000Z');
        assert.equal(task.toolResult?.timestamp, '2026-08-31T10:01:00.000Z', 'the result keeps when it arrived');
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

  function agentTranscript(prompt: string, toolId: string): string {
    return [
      JSON.stringify({
        uuid: 's1',
        isSidechain: true,
        agentId: 'bg99',
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:10.000Z',
        type: 'user',
        message: { role: 'user', content: prompt },
      }),
      JSON.stringify({
        uuid: 's2',
        isSidechain: true,
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:20.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: toolId, name: 'Grep', input: { pattern: 'TODO' } }],
        },
      }),
      JSON.stringify({
        uuid: 's3',
        isSidechain: true,
        sessionId: PROVIDER_SESSION_ID,
        timestamp: '2026-08-31T10:00:30.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolId, content: 'three hits' }],
        },
      }),
    ].join('\n') + '\n';
  }

  test('history resolves a session the watcher has not indexed yet', async () => {
    const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-subagent-home-'));
    const projectPath = '/home/user/unindexed-project';
    const projectDir = path.join(tempHome, '.claude', 'projects', encodeClaudeProjectDir(projectPath));
    const subagentDir = path.join(projectDir, PROVIDER_SESSION_ID, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    await writeFile(path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`), JSON.stringify({
      uuid: 'p1',
      parentUuid: null,
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-08-31T10:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: '/code-review high src/' },
    }) + '\n', 'utf8');
    await writeFile(
      path.join(subagentDir, 'agent-bg99.jsonl'),
      agentTranscript('Review target: `src/`', 'toolu_grep'),
      'utf8',
    );

    const originalHomedir = os.homedir;
    (os as unknown as { homedir: () => string }).homedir = () => tempHome;
    try {
      await withIsolatedDatabase(async () => {
        // No jsonl_path: a forked skill writes only to its agent file, which the
        // watcher ignores, so the row stays unindexed for the whole run.
        sessionsDb.createSession(PROVIDER_SESSION_ID, 'claude', projectPath);
        assert.equal(sessionsDb.getSessionById(PROVIDER_SESSION_ID)?.jsonl_path, null);

        const history = await new ClaudeSessionsProvider().fetchHistory(PROVIDER_SESSION_ID);
        const agents = history.messages.filter(
          (message) => message.kind === 'tool_use' && message.toolName === 'Agent',
        );
        assert.equal(agents.length, 1, 'the derived path should still yield the agent');
      });
    } finally {
      (os as unknown as { homedir: () => string }).homedir = originalHomedir;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('a background agent that wrote no Agent call still reaches history', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-subagent-bg-'));
    const transcriptPath = path.join(tempRoot, `${PROVIDER_SESSION_ID}.jsonl`);
    const subagentDir = path.join(tempRoot, PROVIDER_SESSION_ID, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    // The parent transcript is one plain user turn: no Agent call anywhere.
    await writeFile(transcriptPath, JSON.stringify({
      uuid: 'p1',
      parentUuid: null,
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-08-31T10:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: '/code-review high src/' },
    }) + '\n', 'utf8');
    await writeFile(
      path.join(subagentDir, 'agent-bg99.jsonl'),
      agentTranscript('Review target: `src/`\n\nFind real bugs.', 'toolu_grep'),
      'utf8',
    );
    await writeFile(
      path.join(subagentDir, 'agent-bg99.meta.json'),
      JSON.stringify({ agentType: 'general-purpose' }),
      'utf8',
    );

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
        const agents = history.messages.filter(
          (message) => message.kind === 'tool_use' && message.toolName === 'Agent',
        );

        assert.equal(agents.length, 1, 'the background agent should be recovered');
        const input = agents[0].toolInput as { subagent_type: string; description: string };
        assert.equal(input.subagent_type, 'general-purpose');
        assert.equal(input.description, 'Review target: src/');
        assert.deepEqual(
          (agents[0].subagentTools as Array<{ toolName: string }>).map((tool) => tool.toolName),
          ['Grep'],
        );
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('an Agent call still awaiting its result is resolved, not duplicated', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-subagent-pending-'));
    const transcriptPath = path.join(tempRoot, `${PROVIDER_SESSION_ID}.jsonl`);
    const subagentDir = path.join(tempRoot, PROVIDER_SESSION_ID, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    // The Agent call is in the parent, but it never got a tool_result back.
    await writeFile(transcriptPath, JSON.stringify({
      uuid: 'p1',
      parentUuid: null,
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-08-31T10:00:00.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_agent',
          name: 'Agent',
          input: { description: 'Review the diff', subagent_type: 'code-reviewer' },
        }],
      },
    }) + '\n', 'utf8');
    await writeFile(
      path.join(subagentDir, 'agent-bg99.jsonl'),
      agentTranscript('Review target: `src/`', 'toolu_grep'),
      'utf8',
    );

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
        const agents = history.messages.filter(
          (message) => message.kind === 'tool_use' && message.toolName === 'Agent',
        );

        assert.equal(agents.length, 1, 'the pending call should absorb the transcript');
        assert.equal(agents[0].toolId, 'toolu_agent');
        assert.deepEqual(
          (agents[0].subagentTools as Array<{ toolName: string }>).map((tool) => tool.toolName),
          ['Grep'],
        );
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('a referenced missing agent stays on the uncached tolerant path', async () => {
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

        sessionHistoryCache.clear();
        const history = await sessionsService.fetchHistory(PROVIDER_SESSION_ID);
        const task = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolName === 'Task',
        );

        assert.ok(task, 'history should still load');
        assert.equal(task.subagentTools, undefined);
        assert.equal(sessionHistoryCache.stats().entries, 0);
      });
    } finally {
      sessionHistoryCache.clear();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

// Phase-1 targets execute as TODOs until their implementation phase removes the flag.
// CLIDE_HISTORY_PERF_STRICT=1 makes the same assertions fail the dedicated gate.
describe('history performance targets', () => {




  test('bookmarks walk every record, retain turn context, and reject changed snapshots', () => {
    const messages = Array.from({ length: 9 }, (_, i) => ({
      id: `record-${i}`, sessionId: 'app', provider: 'claude' as const,
      timestamp: '2026-01-01T00:00:00Z', kind: i === 0 ? 'text' as const : 'tool_result' as const,
      role: 'user' as const, content: String(i),
    }));
    const full = { messages, total: 1, hasMore: false, offset: 0, limit: null };
    let page = paginateHistory(full, 'app:provider:branch', { limit: 2 });
    assert.equal(page.recordTotal, 9);
    assert.equal(page.total, 1, 'display count must not control pagination');
    assert.equal(page.turnStartedAt, messages[0].timestamp);
    const bookmark = page.nextCursor!;
    let walked = page.messages;
    while (page.nextCursor) {
      page = paginateHistory(full, 'app:provider:branch', { limit: 2, before: page.nextCursor });
      walked = [...page.messages, ...walked];
    }
    assert.deepEqual(walked, messages);
    const appended = { ...full, messages: [...messages, { ...messages[0], id: 'append' }] };
    const refreshed = paginateHistory(appended, 'app:provider:branch', { limit: 2, from: bookmark });
    assert.deepEqual(refreshed.messages.map(m => m.id), ['record-7', 'record-8', 'append']);
    for (const replacement of [
      { ...full, messages: messages.slice(0, 8) },
      { ...full, messages: messages.map((m, i) => i === 4 ? { ...m, content: 'replaced' } : m) },
      { ...full, messages: [...messages].reverse() },
    ]) assert.throws(() => paginateHistory(replacement, 'app:provider:branch', { before: bookmark }),
      (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
    assert.throws(() => paginateHistory(full, 'different-app:provider:branch', { before: bookmark }),
      (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
    for (const before of ['', '!', 'a'.repeat(1025), Buffer.from('{}').toString('base64url')]) {
      assert.throws(() => paginateHistory(full, 'app:provider:branch', { before }),
        (error: AppError) => error.code === 'INVALID_HISTORY_CURSOR');
    }
    assert.throws(() => paginateHistory(full, 'app:provider:branch', { before: bookmark, offset: 1 }));
    assert.throws(() => paginateHistory(full, 'app:provider:branch', { before: bookmark, from: bookmark }));
    assert.equal(paginateHistory(full, 'app:provider:branch', { limit: 0 }).hasMore, false);
  });

  test('detached windows centre on a record, walk both ways and survive a changing tail', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      id: `record-${i}`, sessionId: 'app', provider: 'claude' as const, timestamp: '2026-01-01T00:00:00Z',
      kind: 'text' as const, role: i % 2 ? 'assistant' as const : 'user' as const, content: String(i),
    }));
    const full = { messages, total: 30, hasMore: false, offset: 0, limit: null };
    const scope = 'app:provider:branch';
    const ids = (page: FetchHistoryResult) => page.messages.map((m) => m.id);
    const window = paginateHistory(full, scope, { around: 'record-10', limit: 6 });
    assert.deepEqual(ids(window), ['record-7', 'record-8', 'record-9', 'record-10', 'record-11', 'record-12']);
    assert.equal(window.hasMore, true);
    assert.equal(window.hasNewer, true);
    let newer = window;
    let below: string[] = [];
    while (newer.newerCursor) {
      newer = paginateHistory(full, scope, { after: newer.newerCursor, limit: 6 });
      below = [...below, ...ids(newer)];
    }
    assert.deepEqual(below, messages.slice(13).map((m) => m.id));
    let older = window;
    let above: string[] = [];
    while (older.nextCursor) {
      older = paginateHistory(full, scope, { before: older.nextCursor, limit: 4 });
      above = [...ids(older), ...above];
    }
    assert.deepEqual(above, messages.slice(0, 7).map((m) => m.id));
    assert.deepEqual(ids(paginateHistory(full, scope, { around: 'record-0', limit: 6 })), messages.slice(0, 6).map((m) => m.id));
    assert.equal(paginateHistory(full, scope, { around: 'record-29', limit: 6 }).hasNewer, false);

    // A live turn rewriting and extending the tail must not strand a reader above it.
    const live = { ...full, messages: [...messages.slice(0, 29), { ...messages[29], content: 'changed' }, { ...messages[0], id: 'appended' }] };
    const caughtUp = paginateHistory(live, scope, { after: window.newerCursor!, limit: 100 });
    assert.deepEqual(ids(caughtUp).slice(-2), ['record-29', 'appended']);
    assert.equal(caughtUp.hasNewer, false);
    assert.throws(() => paginateHistory({ ...full, messages: messages.slice(0, 11) }, scope, { after: window.newerCursor! }),
      (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
    assert.throws(() => paginateHistory(full, 'other-app:provider:branch', { after: window.newerCursor! }),
      (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
    assert.throws(() => paginateHistory(full, scope, { after: window.nextCursor! }),
      (error: AppError) => error.code === 'INVALID_HISTORY_CURSOR');
    assert.throws(() => paginateHistory(full, scope, { around: 'missing' }),
      (error: AppError) => error.code === 'HISTORY_MESSAGE_NOT_FOUND');
    assert.throws(() => paginateHistory(full, scope, { around: 'record-1', before: window.nextCursor! }),
      (error: AppError) => error.code === 'INVALID_QUERY_PARAMETER');

    // The byte budget trims from the side farther from the target and never drops it.
    const budget = { bytes: 3, measure: () => 1 };
    assert.deepEqual(ids(paginateHistory(full, scope, { around: 'record-10', limit: 6 }, budget)), ['record-9', 'record-10', 'record-11']);
    assert.deepEqual(ids(paginateHistory(full, scope, { around: 'record-10', limit: 6 }, { bytes: 0, measure: () => 1 })), ['record-10']);
    assert.equal(paginateHistory(full, scope, { after: window.newerCursor!, limit: 10 }, budget).messages.length, 3);
  });

  test('the find-text payload carries only searchable text, on the same revision as pages', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      for (const provider of ['claude', 'codex'] as const) {
        const id = await fixture.add(provider, 200, 'heavy');
        const direct = (await fixture.readDirect(id, null)).messages;
        const text = await fixture.read(id, null, 0, { payload: 'text' });
        const expected = direct.filter((m) => (m.kind === 'text' || m.kind === 'interactive_prompt'
          || (m.kind === 'tool_result' && !m.toolId)) && (m.content?.trim() || m.followUpQuestions?.length));
        assert.deepEqual(text.messages.map((m) => m.id), expected.map((m) => m.id));
        assert.deepEqual(text.messages.map((m) => m.content), expected.map((m) => m.content), `${provider} prose must stay whole`);
        assert.ok(text.messages.every((m) => m.images === undefined && m.toolInput === undefined && m.sessionId === id));
        assert.equal(text.revision, (await fixture.read(id, 20)).revision);
        const target = expected[3].id;
        const window = await fixture.read(id, 40, 0, { around: target });
        assert.ok(window.messages.some((m) => m.id === target));
        assert.ok(Buffer.byteLength(JSON.stringify(window)) <= historyBudgets.pageBytes || window.messages.length === 1);
        const next = await fixture.read(id, 40, 0, { after: window.newerCursor! });
        assert.equal(next.messages[0].id, direct[direct.findIndex((m) => m.id === window.messages.at(-1)!.id) + 1].id);
      }
    } finally { await fixture.close(); }
  });

  test('provider bookmarks survive rereads and appends but invalidate branch and content replacements', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      for (const provider of ['claude', 'codex'] as const) {
        for (const profile of ['plain', 'mixed'] as const) {
          const id = await fixture.add(provider, 60, profile);
          const reference = await fixture.read(id, null);
          let page = await fixture.read(id, 7);
          let walked = page.messages;
          await fixture.append(id);
          while (page.nextCursor) {
            sessionHistoryCache.clear();
            page = await fixture.read(id, 7, 0, { before: page.nextCursor });
            walked = [...page.messages, ...walked];
          }
          assert.deepEqual(walked, reference.messages, `${provider}/${profile}: exact walk after append and cache eviction`);
          assert.ok(walked.every(m => m.sessionId === id));
          const latest = await fixture.read(id, 7);
          const file = fixture.file(id)!;
          await writeFile(file, '');
          await assert.rejects(fixture.read(id, 7, 0, { before: latest.nextCursor! }),
            (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
        }
      }
      const id = await fixture.add('claude', 60);
      const page = await fixture.read(id, 7);
      await fixture.branch(id, 4);
      await assert.rejects(fixture.read(id, 7, 0, { before: page.nextCursor! }),
        (error: AppError) => error.code === 'HISTORY_CURSOR_INVALIDATED');
    } finally { await fixture.close(); }
  });


  test('Cursor service bookmarks use stable SQLite ordering with unequal app/provider ids', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    const originalHome = os.homedir;
    os.homedir = () => fixture.directory;
    let db: Database.Database | undefined;
    try {
      const nativeId = 'cursor-native';
      const id = 'cursor-app';
      const cwdId = createHash('md5').update(fixture.directory).digest('hex');
      const directory = path.join(fixture.directory, '.cursor/chats', cwdId, nativeId);
      await mkdir(directory, { recursive: true });
      db = new Database(path.join(directory, 'store.db'));
      db.exec('CREATE TABLE blobs (id TEXT, data BLOB)');
      const insert = db.prepare('INSERT INTO blobs VALUES (?, ?)');
      const add = (i: number) => insert.run(`blob-${i}`, Buffer.from(JSON.stringify({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` })));
      for (let i = 0; i < 8; i++) add(i);
      sessionsDb.createAppSession(id, 'cursor', fixture.directory);
      sessionsDb.assignProviderSessionId(id, nativeId);
      const reference = await sessionsService.fetchHistory(id);
      let page = await sessionsService.fetchHistory(id, { limit: 3 });
      let walked = page.messages;
      add(8);
      while (page.nextCursor) {
        page = await sessionsService.fetchHistory(id, { limit: 3, before: page.nextCursor });
        walked = [...page.messages, ...walked];
      }
      assert.deepEqual(walked, reference.messages);
      assert.equal(walked.length, 8);
      assert.ok(walked.every(m => m.sessionId === id));
    } finally { db?.close(); os.homedir = originalHome; await fixture.close(); }
  });

  test('history HTTP route validates query shapes and transports bookmark invalidation', async () => {
    const { default: express } = await import('express');
    const { default: routes } = await import('../provider.routes.js');
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    const app = express();
    app.use(routes);
    app.use((error: AppError, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
      res.status(error.statusCode ?? 500).json({ error: { code: error.code } });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const id = await fixture.add('claude', 10);
      const address = server.address() as import('node:net').AddressInfo;
      const url = `http://127.0.0.1:${address.port}/sessions/${id}/messages`;
      for (const query of ['limit=1x', 'limit=1.5', 'offset=-1', 'offset=9007199254740992', 'before=', 'before=a&before=b', 'limit=', 'around=', 'after=', `around=${'x'.repeat(513)}`, 'after=!']) {
        assert.equal((await fetch(`${url}?${query}`)).status, 400, query);
      }
      const first = await (await fetch(`${url}?limit=3`)).json() as { data: FetchHistoryResult };
      assert.equal(first.data.messages.length, 3);
      assert.ok(first.data.nextCursor);
      const cursor = encodeURIComponent(first.data.nextCursor!);
      await fixture.append(id);
      const older = await (await fetch(`${url}?limit=3&before=${cursor}`)).json() as { data: FetchHistoryResult };
      assert.equal(older.data.messages.length, 3);
      assert.equal(older.data.messages.at(-1)?.id, 'row-6');
      assert.equal((await fetch(`${url}?payload=raw`)).status, 400);
      assert.equal((await fetch(`${url}?around=missing`)).status, 404);
      assert.equal((await fetch(`${url}?payload=text`)).status, 200);
      const detailUrl = `${url}/${encodeURIComponent(older.data.messages[0].id)}`;
      const detail = await (await fetch(detailUrl)).json() as { data: NormalizedMessage };
      assert.deepEqual(detail.data, older.data.messages[0]);
      assert.equal((await fetch(`${url}/missing`)).status, 404);
      assert.equal((await fetch(`${detailUrl}/images/x`)).status, 400);
      assert.equal((await fetch(`${detailUrl}/images/0`)).status, 404);
      await fixture.branch(id, 2);
      const replaced = await fetch(`${url}?limit=3&before=${cursor}`);
      assert.equal(replaced.status, 409);
      assert.equal((await replaced.json() as { error: { code: string } }).error.code, 'HISTORY_CURSOR_INVALIDATED');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await fixture.close();
    }
  });

  test('warm history pages do not reread the transcript and match direct reads', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      for (const provider of ['claude', 'codex'] as const) {
        const id = await fixture.add(provider, 200);
        await fixture.read(id);
        fixture.resetReads();
        const page = await fixture.read(id, 20, 20);
        assert.equal(page.messages.length, 20);
        assert.equal(
          fixture.reads().bytesRead,
          historyBudgets.warmReadBytes,
          `${provider} unchanged warm page must reuse parsed history`,
        );
        assert.deepEqual(legacyPage(page), await fixture.readDirect(id, 20, 20));
      }
    } finally { await fixture.close(); }
  });

  test('concurrent requests share one exact-revision load', async () => {
    const cache = createSessionHistoryCache();
    const source: HistorySourceRevision = {
      scope: 'fixture',
      revision: 'revision-1',
      sourceBytes: 10,
      sources: [],
    };
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loadFull = async (): Promise<FetchHistoryResult> => {
      loads += 1;
      await gate;
      return {
        messages: [{
          id: 'shared',
          sessionId: 'app-shared',
          timestamp: '2026-09-19T00:00:00.000Z',
          provider: 'claude',
          kind: 'text',
          role: 'user',
          content: 'shared',
        } as NormalizedMessage],
        total: 1,
        hasMore: false,
        offset: 0,
        limit: null,
      };
    };
    const args = {
      sessionId: 'app-shared',
      identity: 'claude:native-shared',
      getRevision: async () => source,
      loadFull,
    };
    const first = cache.getFullHistory(args);
    const second = cache.getFullHistory(args);
    release();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(loads, 1);
    assert.equal(left, right);
  });

  test('identity changes, failed loads and memory bounds cannot retain invalid history', async () => {
    const source: HistorySourceRevision = {
      scope: 'fixture', revision: 'revision-1', sourceBytes: 10, sources: [],
    };
    const history = (marker: string): FetchHistoryResult => ({
      messages: [{
        id: marker,
        sessionId: 'app-cache',
        timestamp: '2026-09-19T00:00:00.000Z',
        provider: 'claude',
        kind: 'text',
        role: 'user',
        content: marker,
      } as NormalizedMessage],
      total: 1,
      hasMore: false,
      offset: 0,
      limit: null,
    });
    const cache = createSessionHistoryCache({ maxEntries: 1 });
    let loads = 0;
    const read = (sessionId: string, identity: string, marker: string) => cache.getFullHistory({
      sessionId,
      identity,
      getRevision: async () => source,
      loadFull: async () => { loads += 1; return history(marker); },
    });
    await read('app-cache', 'claude:native-a', 'a');
    assert.equal((await read('app-cache', 'codex:native-b', 'b'))?.messages[0]?.id, 'b');
    await read('another-app', 'claude:native-c', 'c');
    assert.equal(cache.stats().entries, 1);
    assert.equal((await read('app-cache', 'codex:native-b', 'b-again'))?.messages[0]?.id, 'b-again');

    let attempts = 0;
    await assert.rejects(cache.getFullHistory({
      sessionId: 'failed-app',
      identity: 'claude:failed',
      getRevision: async () => source,
      loadFull: async () => { attempts += 1; throw new Error('read failed'); },
    }), /read failed/);
    const recovered = await cache.getFullHistory({
      sessionId: 'failed-app',
      identity: 'claude:failed',
      getRevision: async () => source,
      loadFull: async () => { attempts += 1; return history('recovered'); },
    });
    assert.equal(recovered?.messages[0]?.id, 'recovered');
    assert.equal(attempts, 2);

    const noRetention = createSessionHistoryCache({ maxRetainedBytes: 1 });
    await noRetention.getFullHistory({
      sessionId: 'oversized',
      identity: 'claude:oversized',
      getRevision: async () => source,
      loadFull: async () => history('too large to retain'),
    });
    assert.deepEqual(noRetention.stats(), { entries: 0, retainedBytes: 0, pendingLoads: 0 });
    assert.ok(loads >= 4);
  });

  test('an append between history pages does not overlap the loaded page', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      const id = await fixture.add('claude', 100);
      const newest = await fixture.read(id);
      await fixture.append(id);
      const older = await fixture.read(id, 20, 0, { before: newest.nextCursor! });
      const ids = new Set(newest.messages.map((message) => message.id));
      assert.equal(older.messages.filter((message) => ids.has(message.id)).length, historyBudgets.duplicateMessages);
    } finally { await fixture.close(); }
  });

  test('heavy pages hold the byte budget while details, images and full payloads stay complete', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      for (const provider of ['claude', 'codex'] as const) {
        const id = await fixture.add(provider, 200, 'heavy');
        const direct = (await fixture.readDirect(id, null)).messages;
        let page = await fixture.read(id, 20);
        let walked = page.messages;
        let elided = 0;
        for (;;) {
          assert.ok(page.messages.length === 1 || Buffer.byteLength(JSON.stringify(page)) <= historyBudgets.pageBytes,
            `${provider} page exceeds the byte budget`);
          if (!page.nextCursor) break;
          page = await fixture.read(id, 20, 0, { before: page.nextCursor });
          walked = [...page.messages, ...walked];
        }
        assert.deepEqual(walked.map((m) => m.id), direct.map((m) => m.id), `${provider} budget must not drop records`);
        for (const [index, message] of walked.entries()) {
          if (!message.elidedDetail) continue;
          elided += 1;
          const detail = await sessionsService.fetchHistoryMessage(id, message.id);
          assert.deepEqual({ ...detail, sessionId: '' }, { ...direct[index], sessionId: '' });
        }
        assert.ok(elided > 0, `${provider} heavy fixture must elide tool output`);
        const full = await sessionsService.fetchHistory(id, { limit: null, payload: 'full' });
        assert.deepEqual(full.messages.map((m) => ({ ...m, sessionId: '' })), direct.map((m) => ({ ...m, sessionId: '' })));
        if (provider === 'claude') {
          const withImage = walked.find((m) => Array.isArray(m.images) && m.images.length > 0)!;
          const [image] = withImage.images as Array<{ url?: string; data?: string; mediaType?: string }>;
          assert.equal(image.data, undefined);
          assert.equal(image.mediaType, 'image/png');
          assert.match(image.url!, new RegExp(`/sessions/${id}/messages/.+/images/0$`));
          const served = await sessionsService.fetchHistoryImage(id, withImage.id, 0);
          const original = (direct.find((m) => m.id === withImage.id)!.images as Array<{ data: string }>)[0].data;
          assert.equal(`data:${served.mediaType};base64,${served.body.toString('base64')}`, original);
          await assert.rejects(sessionsService.fetchHistoryImage(id, withImage.id, 1),
            (error: AppError) => error.code === 'HISTORY_IMAGE_NOT_FOUND');
        }
        await assert.rejects(sessionsService.fetchHistoryMessage(id, 'missing'),
          (error: AppError) => error.code === 'HISTORY_MESSAGE_NOT_FOUND');
      }
    } finally { await fixture.close(); }
  });

  test('page copies never shorten prose or mutate the cached record', () => {
    const prose = 'word '.repeat(80_000);
    const tool = {
      id: 'tool', sessionId: 'app', provider: 'claude' as const, timestamp: '2026-01-01T00:00:00Z', kind: 'tool_use' as const,
      toolName: 'Bash', toolInput: { command: 'x', description: 'y' }, turnId: 'turn-1',
      toolResult: { content: 'line\n'.repeat(5000), isError: false, timestamp: '2026-01-01T00:00:03Z', toolUseResult: { stdout: 'z'.repeat(20_000), exitCode: 0, filenames: Array.from({ length: 5000 }, (_, i) => `f${i}`) } },
    };
    const text = { id: 'text', sessionId: 'app', provider: 'claude' as const, timestamp: '2026-01-01T00:00:01Z', kind: 'text' as const, role: 'assistant' as const, content: prose };
    const before = JSON.stringify(tool);
    const slim = slimHistoryMessage(tool, 'app');
    assert.equal(JSON.stringify(tool), before);
    assert.equal(slimHistoryMessage(text, 'app'), text);
    assert.deepEqual(slim.elidedDetail, { bytes: Buffer.byteLength(before), resultLines: 5000 });
    const result = slim.toolResult as { content: string; timestamp: string; toolUseResult: { stdout: string; exitCode: number; filenames: string[] } };
    assert.equal(result.toolUseResult.exitCode, 0);
    assert.deepEqual([result.timestamp, slim.turnId], ['2026-01-01T00:00:03Z', 'turn-1'], 'activity fields survive slimming');
    assert.ok(result.content.length < 2048 && result.toolUseResult.stdout.length < 2048);
    assert.ok(JSON.stringify(result.toolUseResult.filenames).length <= 8192);
    assert.deepEqual(slim.toolInput, tool.toolInput);
    const full = { messages: [tool, text, { ...text, id: 'small', content: 'hi' }], total: 3, hasMore: false, offset: 0, limit: null };
    const budget = { bytes: historyBudgets.pageBytes, measure: (m: NormalizedMessage) => measureHistoryMessage(m, 'app') };
    const pages: string[][] = [];
    let page = paginateHistory(full, 'app', { limit: 20 }, budget);
    pages.push(page.messages.map((m) => m.id));
    while (page.nextCursor) {
      page = paginateHistory(full, 'app', { limit: 20, before: page.nextCursor }, budget);
      pages.unshift(page.messages.map((m) => m.id));
    }
    assert.deepEqual(pages, [['tool'], ['text'], ['small']], 'an oversized prose record gets a page of its own');
  });

  test('synthetic readers retain full history, branch filtering and dependent-file updates', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      for (const provider of ['claude', 'codex'] as const) {
        const id = await fixture.add(provider, 200);
        const all = await fixture.read(id, null);
        assert.equal(all.messages.length, 200, `${provider} fixture must exercise the real reader`);
        assert.ok(all.messages.every((message) => message.sessionId === id));
        const pages = [];
        for (let offset = 0; offset < 200; offset += 20) pages.unshift(...(await fixture.read(id, 20, offset)).messages);
        assert.deepEqual(pages.map((m) => m.id), all.messages.map((m) => m.id));
      }
      const id = await fixture.add('claude', 100);
      await fixture.read(id, null);
      await fixture.branch(id, 79);
      const branch = await fixture.read(id, null);
      assert.equal(branch.messages.length, 81);
      assert.ok(!branch.messages.some((message) => message.content?.includes('Synthetic message 95.')));
      await fixture.subagent(id, 'child before');
      const first = await fixture.read(id, null);
      assert.ok(JSON.stringify(first).includes('child before'));
      await fixture.subagent(id, 'child after');
      const second = await fixture.read(id, null);
      assert.ok(JSON.stringify(second).includes('child after'));
      assert.ok(!JSON.stringify(second).includes('child before'));
      const fork = await fixture.addCodexFork();
      const parentBefore = await fixture.read(fork.appId, null);
      assert.ok(JSON.stringify(parentBefore).includes('Synthetic message 1.'));
      await appendFile(fork.parentFile, JSON.stringify({
        type: 'response_item',
        timestamp: '2026-09-19T00:00:00.000Z',
        payload: {
          type: 'message',
          id: 'parent-refresh',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Parent dependency refreshed.' }],
        },
        ordinal: fork.parentCount + 1,
      }) + '\n');
      const parentAfter = await fixture.read(fork.appId, null);
      assert.ok(JSON.stringify(parentAfter).includes('Parent dependency refreshed.'));
      const mixed = await fixture.read(await fixture.add('claude', 40, 'mixed'), null);
      assert.ok(mixed.messages.some((message) => message.kind === 'tool_use' && message.toolResult));
      assert.ok(mixed.messages.some((message) => Array.isArray(message.images) && message.images.length > 0));
      assert.ok(!mixed.messages.some((message) => message.content?.includes('Synthetic message 6.')));
    } finally { await fixture.close(); }
  });

  test('replacement, truncation, partial writes and missing files never leave a stale valid entry', async () => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    try {
      const id = await fixture.add('claude', 40);
      const transcriptPath = fixture.file(id);
      assert.ok(transcriptPath);
      await fixture.read(id, null);

      const original = await readFile(transcriptPath, 'utf8');
      const originalStat = await stat(transcriptPath);
      const replacement = original.replace('Synthetic message 1.', 'Alternate message 1.');
      assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
      await writeFile(transcriptPath, replacement);
      await utimes(transcriptPath, originalStat.atime, originalStat.mtime);
      const replaced = await fixture.read(id, null);
      assert.ok(JSON.stringify(replaced).includes('Alternate message 1.'));

      await writeFile(transcriptPath, replacement.split('\n').slice(0, 20).join('\n') + '\n');
      const truncated = await fixture.read(id, null);
      assert.equal(truncated.messages.length, 20);

      await appendFile(transcriptPath, '{"partial":');
      fixture.resetReads();
      await fixture.read(id, null);
      assert.ok(fixture.reads().bytesRead > 0);
      fixture.resetReads();
      await fixture.read(id, null);
      assert.ok(fixture.reads().bytesRead > 0, 'a partial tail must not become a cache hit');
      await appendFile(transcriptPath, '\n');
      fixture.resetReads();
      await fixture.read(id, null);
      assert.ok(fixture.reads().bytesRead > 0, 'a malformed complete row must not become a cache hit');

      await rm(transcriptPath);
      const missing = await fixture.read(id, null);
      assert.equal(missing.messages.length, 0);
      await writeFile(transcriptPath, original);
      const restored = await fixture.read(id, null);
      assert.equal(restored.messages.length, 40);
    } finally { await fixture.close(); }
  });
});


describe('history cache review regressions', () => {
  test('subagent creation during discovery remains tracked after subsequent edits', async (t) => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    const original = fsp.readdir;
    try {
      const id = await fixture.add('claude', 40);
      const dir = path.join(fixture.file(id)!.replace(/\.jsonl$/, ''), 'subagents');
      await mkdir(dir, { recursive: true });
      let injected = false;
      t.mock.method(fsp, 'readdir', async (...args: Parameters<typeof original>) => {
        const listed = await Reflect.apply(original, fsp, args);
        if (!injected && String(args[0]) === dir && typeof args[1] === 'object' && args[1]?.withFileTypes) {
          injected = true;
          await fixture.subagent(id, 'child-before');
        }
        return listed;
      });
      await fixture.read(id, null);
      t.mock.restoreAll();
      await fixture.subagent(id, 'child-after');
      assert.equal(injected, true);
      assert.deepEqual(legacyPage(await fixture.read(id, null)), await fixture.readDirect(id, null));
    } finally { t.mock.restoreAll(); await fixture.close(); }
  });

  test('transient subagent directory errors do not cache incomplete history', async (t) => {
    const { createHistoryFixture } = await import('./chat-history.fixture.js');
    const fixture = await createHistoryFixture();
    const original = fsp.readdir;
    try {
      const id = await fixture.add('claude', 40);
      await fixture.subagent(id, 'must-not-disappear');
      const dir = path.join(fixture.file(id)!.replace(/\.jsonl$/, ''), 'subagents');
      let failed = false;
      t.mock.method(fsp, 'readdir', async (...args: Parameters<typeof original>) => {
        if (!failed && String(args[0]) === dir && !args[1]) {
          failed = true;
          throw Object.assign(new Error('synthetic directory read failure'), { code: 'EIO' });
        }
        return Reflect.apply(original, fsp, args);
      });
      await fixture.read(id, null);
      t.mock.restoreAll();
      assert.equal(failed, true);
      assert.deepEqual(legacyPage(await fixture.read(id, null)), await fixture.readDirect(id, null));
    } finally { t.mock.restoreAll(); await fixture.close(); }
  });

  test('an older identity cannot repopulate the cache after the newer request finishes', async () => {
    const cache = createSessionHistoryCache();
    const source: HistorySourceRevision = { scope: 'review', revision: '1', sourceBytes: 0, sources: [] };
    const full: FetchHistoryResult = { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const older = cache.getFullHistory({
      sessionId: 'review-overlap', identity: 'old', getRevision: async () => source,
      loadFull: async () => { started(); await gate; return full; },
    });
    await entered;
    let newerLoads = 0;
    const newerArgs = {
      sessionId: 'review-overlap', identity: 'new', getRevision: async () => source,
      loadFull: async () => { newerLoads++; return full; },
    };
    try {
      await cache.getFullHistory(newerArgs);
      release();
      await older;
      await cache.getFullHistory(newerArgs);
      assert.equal(newerLoads, 1, 'the completed newer cache entry must survive the older request');
    } finally { release(); await older; cache.clear(); }
  });

  test('identity bookkeeping is released after uncacheable requests', async (t) => {
    const cache = createSessionHistoryCache({ maxEntries: 1 });
    const original = Map.prototype.set;
    const tracked = new Set<Map<unknown, unknown>>();
    t.mock.method(Map.prototype, 'set', function(this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (value === 'review-identity' || (value as { identity?: string })?.identity === 'review-identity') tracked.add(this);
      return original.call(this, key, value);
    });
    try {
      for (let i = 0; i < 100; i++) await cache.getFullHistory({
        sessionId: `review-${i}`, identity: 'review-identity',
        getRevision: async () => null,
        loadFull: async () => { throw new Error('must not load'); },
      });
      assert.ok(tracked.size > 0);
      assert.equal([...tracked].reduce((sum, map) => sum + map.size, 0), 0);
    } finally { t.mock.restoreAll(); cache.clear(); }
  });
});
