import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import type { CodexLiveModel } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { readCodexAccountUsage, readCodexModelList } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { CODEX_FALLBACK_MODELS, CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import {
  CodexSessionsProvider,
  normalizeAndRedactCodexQuestionAnswers,
  normalizePersistedCodexQuestions,
} from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CodexProviderUsage, normalizeCodexAccountActivity, normalizeCodexRateLimits } from '@/modules/providers/list/codex/codex-usage.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { SessionModelPickStore } from '@/modules/providers/services/provider-session-model.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { extractCodexContextTokenUsage } from '@/shared/codex-token-usage.js';

describe('codex-sessions', () => {
  const patchHomeDir = (nextHomeDir: string) => {
    const original = os.homedir;
    (os as any).homedir = () => nextHomeDir;
    return () => {
      (os as any).homedir = original;
    };
  };

  async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
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

  /**
   * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
   * `event_msg`/`user_message` payload the runtime records for the prompt the
   * user typed; omitting it produces a transcript with no user turn.
   */
  const writeCodexTranscript = async (
    homeDir: string,
    codexSessionId: string,
    workspacePath: string,
    firstUserMessage?: string,
  ): Promise<string> => {
    const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });

    const lines: string[] = [
      JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
    ];
    if (firstUserMessage !== undefined) {
      lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
    }

    const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
    await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
  };

  test('Codex context usage prefers the latest request over cumulative rollout usage', () => {
    const usage = extractCodexContextTokenUsage({
      total_token_usage: {
        input_tokens: 406000,
        output_tokens: 500,
        total_tokens: 406500,
      },
      last_token_usage: {
        input_tokens: 36100,
        output_tokens: 59,
        total_tokens: 36159,
      },
      model_context_window: 258400,
    });

    assert.deepEqual(usage, {
      used: 36159,
      total: 258400,
      inputTokens: 36100,
      outputTokens: 59,
      breakdown: { input: 36100, output: 59 },
    });
  });

  test('Codex persisted question helpers preserve ids and arrays while redacting secrets', () => {
    const questions = normalizePersistedCodexQuestions([
      {
        id: 'choice',
        header: 'Choice',
        question: 'Pick one',
        isOther: true,
        isSecret: false,
        options: [{ label: 'A', description: 'First option' }],
      },
      {
        id: 'secret',
        header: 'Secret',
        question: 'Token',
        isOther: false,
        isSecret: true,
        options: null,
      },
    ]);
    assert.deepEqual(questions, [
      {
        id: 'choice',
        header: 'Choice',
        question: 'Pick one',
        options: [{ label: 'A', description: 'First option' }],
        allowOther: true,
        isSecret: false,
        multiSelect: false,
      },
      {
        id: 'secret',
        header: 'Secret',
        question: 'Token',
        options: [],
        allowOther: false,
        isSecret: true,
        multiSelect: false,
      },
    ]);
    assert.deepEqual(normalizeAndRedactCodexQuestionAnswers(
      JSON.stringify({
        answers: {
          choice: { answers: ['A', 'custom'] },
          secret: { answers: ['never-deliver-this'] },
        },
      }),
      new Set(['secret']),
    ), {
      choice: ['A', 'custom'],
      secret: ['[redacted]'],
    });
  });

  test('Codex history links request_user_input calls to redacted answer arrays', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-question-history-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const transcriptPath = path.join(tempRoot, 'rollout-question.jsonl');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-07-25T12:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          call_id: 'question-call',
          arguments: JSON.stringify({
            questions: [
              {
                id: 'choice',
                header: 'Choice',
                question: 'Pick one',
                isOther: true,
                isSecret: false,
                options: [{ label: 'A', description: 'First option' }],
              },
              {
                id: 'secret',
                header: 'Secret',
                question: 'Token',
                isOther: false,
                isSecret: true,
                options: null,
              },
            ],
          }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-25T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'question-call',
          output: JSON.stringify({
            answers: {
              choice: { answers: ['A', 'custom'] },
              secret: { answers: ['never-deliver-this'] },
            },
          }),
        },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'codex-question-history',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('codex-question-history');
        const toolUse = history.messages.find((message) =>
          message.kind === 'tool_use' && message.toolName === 'request_user_input');
        assert.ok(toolUse);
        assert.deepEqual((toolUse.toolInput as { questions: unknown }).questions, [
          {
            id: 'choice',
            header: 'Choice',
            question: 'Pick one',
            options: [{ label: 'A', description: 'First option' }],
            allowOther: true,
            isSecret: false,
            multiSelect: false,
          },
          {
            id: 'secret',
            header: 'Secret',
            question: 'Token',
            options: [],
            allowOther: false,
            isSecret: true,
            multiSelect: false,
          },
        ]);
        assert.deepEqual(toolUse.toolResult?.toolUseResult, {
          answers: {
            choice: ['A', 'custom'],
            secret: ['[redacted]'],
          },
        });
        assert.ok(!JSON.stringify(history).includes('never-deliver-this'));
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history uses the provider turn id as the user-message rewind anchor', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-turn-anchor-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const transcriptPath = path.join(tempRoot, 'rollout-turn-anchor.jsonl');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-07-25T12:00:00.000Z',
        type: 'turn_context',
        payload: { turn_id: '019f9c81-1111-7777-8888-999999999999' },
      }),
      JSON.stringify({
        timestamp: '2026-07-25T12:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Edit this prompt' },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'codex-turn-anchor',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('codex-turn-anchor');
        const user = history.messages.find((message) => message.role === 'user');
        assert.equal(user?.id, '019f9c81-1111-7777-8888-999999999999');
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history restores canonical user rows without startup context or legacy duplicates', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-canonical-user-history-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const transcriptPath = path.join(tempRoot, 'rollout-canonical-user-history.jsonl');
    const imageDataUrl = 'data:image/png;base64,QUJD';
    await mkdir(workspacePath, { recursive: true });
    await writeFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-09-01T12:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-canonical' },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:00:00.100Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>injected startup context</environment_context>' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:00:00.200Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-canonical' },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:00:00.300Z',
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'message-canonical',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Keep this canonical prompt' },
            { type: 'input_text', text: '<image name=[Image #1] path="/tmp/shot.png">' },
            { type: 'input_image', image_url: imageDataUrl },
            { type: 'input_text', text: '</image>' },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:01:00.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-compatible' },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:01:00.100Z',
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'message-compatible',
          role: 'user',
          content: [{ type: 'input_text', text: 'Keep one compatible prompt' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:01:00.100Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Keep one compatible prompt' },
      }),
      // Pre-0.152 rollouts after compaction: injected context sits inside its
      // own turn_context and the legacy row lands ~1ms after the canonical one.
      JSON.stringify({
        timestamp: '2026-09-01T12:02:00.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-legacy' },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:02:00.050Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:02:00.060Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-legacy' },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:02:00.100Z',
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'message-legacy',
          role: 'user',
          content: [{ type: 'input_text', text: 'Keep one legacy prompt' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-01T12:02:00.101Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Keep one legacy prompt' },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'codex-canonical-user-history',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('codex-canonical-user-history');
        const users = history.messages.filter((message) => message.role === 'user');

        assert.equal(users.length, 3);
        assert.equal(users[0].id, 'turn-canonical');
        assert.equal(users[0].content, 'Keep this canonical prompt');
        assert.deepEqual(users[0].images, [{ data: imageDataUrl }]);
        assert.equal(users[1].id, 'turn-compatible');
        assert.equal(users[1].content, 'Keep one compatible prompt');
        assert.equal(users[2].id, 'turn-legacy');
        assert.equal(users[2].content, 'Keep one legacy prompt');
        assert.ok(!JSON.stringify(history).includes('injected startup context'));
        assert.ok(!JSON.stringify(history).includes('environment_context'));
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history keeps the usage-limit failure that ended a turn', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-turn-failure-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const transcriptPath = path.join(tempRoot, 'rollout-turn-failure.jsonl');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-07-25T12:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Continue' },
      }),
      JSON.stringify({
        timestamp: '2026-07-25T12:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          last_agent_message: null,
          error: {
            message: "You've hit your usage limit. Try again at 12:34 PM.",
            codex_error_info: 'usage_limit_exceeded',
          },
        },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'codex-turn-failure',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('codex-turn-failure');
        const failure = history.messages.find((message) => message.kind === 'error');
        assert.equal(failure?.content, "You've hit your usage limit. Try again at 12:34 PM.");
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history preserves response-item ids used by live App Server messages', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-response-item-id-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const transcriptPath = path.join(tempRoot, 'rollout-response-item-id.jsonl');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-07-25T12:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'reasoning',
          id: 'reasoning-item-1',
          summary: [{ type: 'summary_text', text: 'Checked the event path.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-25T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'assistant-item-1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'One persisted final response.' }],
        },
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'codex-response-item-id',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          transcriptPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('codex-response-item-id');

        assert.equal(
          history.messages.find((message) => message.kind === 'thinking')?.id,
          'reasoning-item-1',
        );
        assert.equal(
          history.messages.find((message) => message.role === 'assistant')?.id,
          'assistant-item-1',
        );
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex explicit fork allocates a separate stable CLIde session and preserves its parent', { concurrency: false }, async () => {
    const sessionsProvider = providerRegistry.resolveProvider('codex').sessions;
    const originalForkSession = sessionsProvider.forkSession;

    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createAppSession('app-parent', 'codex', '/workspace/demo');
        sessionsDb.assignProviderSessionId('app-parent', 'provider-parent');
        sessionsDb.updateSessionCustomName('app-parent', 'Investigate rewind');
        sessionsProvider.forkSession = async (providerSessionId, options) => {
          assert.equal(providerSessionId, 'provider-parent');
          assert.equal(options?.projectPath, '/workspace/demo');
          assert.equal(options?.lastTurnId, 'turn-b');
          return {
            providerSessionId: 'provider-child',
            projectPath: '/workspace/demo',
            jsonlPath: '/tmp/provider-child.jsonl',
          };
        };

        const result = await sessionsService.forkSessionById('app-parent', {
          model: 'gpt-test',
          permissionMode: 'default',
          lastTurnId: 'turn-b',
        });

        assert.notEqual(result.sessionId, 'app-parent');
        assert.equal(result.summary, 'Fork: Investigate rewind');
        assert.equal(
          sessionsDb.getSessionById('app-parent')?.provider_session_id,
          'provider-parent',
        );
        const child = sessionsDb.getSessionById(result.sessionId);
        assert.equal(child?.provider_session_id, 'provider-child');
        assert.equal(child?.custom_name, 'Fork: Investigate rewind');
        assert.equal(child?.jsonl_path, '/tmp/provider-child.jsonl');
      });
    } finally {
      sessionsProvider.forkSession = originalForkSession;
    }
  });

  test('Codex synchronizer titles app-created sessions from the first user message', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      const transcriptPath = await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath);
      await writeFile(transcriptPath, [
        JSON.stringify({ type: 'session_meta', payload: { id: 'codex-app-1', cwd: workspacePath } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-app-1' } }),
        JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-app-1' } }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<environment_context>ignore this</environment_context>' }],
          },
        }),
        JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-app-1' } }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fix the login redirect bug' }],
          },
        }),
      ].join('\n') + '\n', 'utf8');
      await withIsolatedDatabase(async () => {
        // The app allocates its own id and later maps the provider id onto it,
        // exactly as a message sent from cloudcli does.
        sessionsDb.createAppSession('app-1', 'codex', workspacePath);
        sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

        const synchronizer = new CodexSessionSynchronizer();
        await synchronizer.synchronize();

        assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect bug');
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex synchronizer skips sub-agent rollout files', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-subagent-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      // Codex >=0.144 spawn_agent threads write their own rollout files into the
      // same sessions tree, marked via thread_source/source in session_meta.
      const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(
        path.join(sessionsDir, 'rollout-codex-subagent-1.jsonl'),
        `${JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'codex-subagent-1',
            cwd: workspacePath,
            thread_source: 'subagent',
            parent_thread_id: 'codex-parent-1',
            source: { subagent: { thread_spawn: { parent_thread_id: 'codex-parent-1', depth: 1 } } },
          },
        })}\n`,
        'utf8'
      );
      await writeCodexTranscript(tempRoot, 'codex-parent-1', workspacePath);

      await withIsolatedDatabase(async () => {
        const synchronizer = new CodexSessionSynchronizer();
        const processed = await synchronizer.synchronize();

        assert.equal(processed, 1);
        assert.ok(sessionsDb.getSessionById('codex-parent-1'));
        assert.equal(sessionsDb.getSessionById('codex-subagent-1'), null);
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      // A CLI-created session has no app row; its first user message must NOT be
      // used as the title, preserving the existing indexing behavior.
      await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
      await withIsolatedDatabase(async () => {
        const synchronizer = new CodexSessionSynchronizer();
        await synchronizer.synchronize();

        assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex synchronizer labels top-level fork lineage instead of an unrelated duplicate', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-fork-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(workspacePath, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      await writeCodexTranscript(tempRoot, 'codex-parent', workspacePath);
      await writeFile(
        path.join(sessionsDir, 'rollout-codex-child.jsonl'),
        `${JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'codex-child',
            cwd: workspacePath,
            thread_source: 'user',
            forked_from_id: 'codex-parent',
          },
        })}\n`,
        'utf8',
      );

      await withIsolatedDatabase(async () => {
        sessionsDb.createSession('codex-parent', 'codex', workspacePath, 'Investigate rewind');
        const synchronizer = new CodexSessionSynchronizer();
        await synchronizer.synchronize();

        assert.equal(
          sessionsDb.getSessionById('codex-child')?.custom_name,
          'Fork: Investigate rewind',
        );
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history restores current and legacy exec wrappers without exposing controls', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exec-history-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      const providerSessionId = 'codex-exec-1';
      const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
      const legacyExecInput = 'const cmds = ["echo one", "echo two"]; await Promise.all(cmds.map(command => tools.shell_command({ command })));';
      const currentExecInput = 'const result = await tools.exec_command({"cmd":"echo current","workdir":"/workspace"}); text(result.output);';
      const planInput = 'await tools.update_plan({ plan: [] });';
      const unknownExecInput = 'const result = await tools.view_image({"path":"/tmp/example.png"}); image(result.image_url);';
      await writeFile(transcriptPath, [
        JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'legacy-exec', input: legacyExecInput } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'legacy-exec', output: 'legacy done' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'current-exec', input: currentExecInput } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'current-exec', output: 'current done' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'plan-1', input: planInput } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'plan-1', output: 'done' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'unknown-exec', input: unknownExecInput } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'unknown-exec', output: 'image done' } }),
      ].join('\n') + '\n', 'utf8');

      await withIsolatedDatabase(async () => {
        sessionsDb.createAppSession('app-exec-1', 'codex', workspacePath);
        sessionsDb.assignProviderSessionId('app-exec-1', providerSessionId);
        await new CodexSessionSynchronizer().synchronize();

        const history = await new CodexSessionsProvider().fetchHistory('app-exec-1');
        const toolUses = history.messages.filter((message) => message.kind === 'tool_use');
        const toolResults = history.messages.filter((message) => message.kind === 'tool_result');

        assert.equal(toolUses.length, 3);
        assert.equal(toolUses[0].toolName, 'Bash');
        assert.equal(toolUses[0].toolInput, JSON.stringify({ command: 'echo one\necho two' }));
        assert.equal(toolUses[0].toolResult?.content, 'legacy done');
        assert.equal(toolUses[1].toolName, 'Bash');
        assert.equal(toolUses[1].toolInput, JSON.stringify({ command: 'echo current' }));
        assert.equal(toolUses[1].toolResult?.content, 'current done');
        assert.equal(toolUses[2].toolName, 'exec');
        assert.equal(toolUses[2].toolInput, unknownExecInput);
        assert.equal(toolUses[2].toolResult?.content, 'image done');
        assert.equal(toolResults.some((message) => message.toolCallId === 'plan-1'), false);
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex history stitches a rewind fork back onto its parent rollout', { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-fork-history-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    // The parent sits under its own creation date, so the child's directory is
    // never enough to find it.
    const parentDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    const childDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '08');
    await mkdir(workspacePath, { recursive: true });
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    const restoreHomeDir = patchHomeDir(tempRoot);

    const userRow = (ordinal: number, timestamp: string, turnId: string, text: string) => [
      JSON.stringify({ ordinal, timestamp, type: 'turn_context', payload: { turn_id: turnId } }),
      JSON.stringify({
        ordinal: ordinal + 1,
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }),
    ];

    try {
      await writeFile(path.join(parentDir, 'rollout-fork-parent.jsonl'), [
        JSON.stringify({ ordinal: 0, type: 'session_meta', payload: { id: 'fork-parent', cwd: workspacePath } }),
        ...userRow(1, '2026-09-01T12:00:00.000Z', 'turn-kept', 'Prompt before the rewind'),
        // The turn the rewind abandoned; it survives on disk but must not render.
        ...userRow(3, '2026-09-01T12:01:00.000Z', 'turn-abandoned', 'Draft that was edited away'),
      ].join('\n') + '\n', 'utf8');

      const childPath = path.join(childDir, 'rollout-fork-child.jsonl');
      await writeFile(childPath, [
        JSON.stringify({
          ordinal: 3,
          type: 'session_meta',
          payload: {
            id: 'fork-child',
            cwd: workspacePath,
            forked_from_id: 'fork-parent',
            forked_from_ordinal_exclusive: 3,
          },
        }),
        ...userRow(4, '2026-09-01T12:02:00.000Z', 'turn-resent', 'Edited prompt, resent'),
      ].join('\n') + '\n', 'utf8');

      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(
          'app-fork-session',
          'codex',
          workspacePath,
          undefined,
          undefined,
          undefined,
          childPath,
        );
        const history = await new CodexSessionsProvider().fetchHistory('app-fork-session');
        const users = history.messages.filter((message) => message.role === 'user');

        assert.deepEqual(users.map((message) => message.content), [
          'Prompt before the rewind',
          'Edited prompt, resent',
        ]);
      });
    } finally {
      restoreHomeDir();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('codex-models', () => {
  const LIVE_MODEL: CodexLiveModel = {
    id: 'gpt-live-id',
    model: 'gpt-live',
    displayName: 'GPT Live',
    description: 'Selected runtime model',
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
    ],
    defaultReasoningEffort: 'medium',
    isDefault: true,
  };

  test('Codex models prefer the selected runtime live catalog', async () => {
    const provider = new CodexProviderModels({
      readLiveModels: async () => [LIVE_MODEL, { ...LIVE_MODEL, id: 'hidden', hidden: true }],
    });

    assert.deepEqual(await provider.getSupportedModels(), {
      OPTIONS: [{
        value: 'gpt-live',
        label: 'GPT Live',
        description: 'Selected runtime model',
        isDefault: true,
        effort: {
          default: 'medium',
          values: [
            { value: 'medium', description: 'Balanced' },
            { value: 'high', description: 'Deep' },
          ],
        },
      }],
      DEFAULT: 'gpt-live',
      source: 'live',
    });
  });

  test('Codex models label the CLI cache stale when the live runtime read fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-models-'));
    const cachePath = path.join(root, 'models_cache.json');
    await writeFile(cachePath, JSON.stringify({
      models: [{
        slug: 'gpt-cached',
        display_name: 'GPT Cached',
        description: 'Cached catalog',
        priority: 1,
        visibility: 'list',
        supported_in_api: true,
        default_reasoning_level: 'high',
        supported_reasoning_levels: [{ effort: 'high', description: 'Deep' }],
      }],
    }), 'utf8');
    const provider = new CodexProviderModels({
      readLiveModels: async () => { throw new Error('offline'); },
      modelsCachePath: cachePath,
    });

    try {
      const models = await provider.getSupportedModels();
      assert.equal(models.source, 'stale');
      assert.equal(models.DEFAULT, 'gpt-cached');
      assert.equal(models.OPTIONS[0]?.value, 'gpt-cached');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('Codex models label the hardcoded catalog as fallback', async () => {
    const provider = new CodexProviderModels({
      readLiveModels: async () => { throw new Error('offline'); },
      modelsCachePath: path.join(os.tmpdir(), `missing-codex-models-${Date.now()}.json`),
    });
    assert.deepEqual(await provider.getSupportedModels(), CODEX_FALLBACK_MODELS);
    assert.equal((await provider.getSupportedModels()).source, 'fallback');
  });

  test('Codex reads each session model from that session rollout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-session-models-'));
    const firstPath = path.join(root, 'first.jsonl');
    const secondPath = path.join(root, 'second.jsonl');
    await writeFile(firstPath, [
      JSON.stringify({
        type: 'turn_context',
        timestamp: '2026-08-21T20:00:00.000Z',
        payload: { model: 'gpt-5.4', effort: 'high' },
      }),
      '{"type":"turn_context"',
    ].join('\n'), 'utf8');
    await writeFile(secondPath, JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-08-21T20:01:00.000Z',
      payload: { model: 'gpt-5.6-sol', effort: 'high' },
    }), 'utf8');

    const provider = new CodexProviderModels({
      lookupSessionRow: (sessionId) => ({
        jsonl_path: sessionId === 'session-a' ? firstPath : secondPath,
      }),
    });

    try {
      assert.deepEqual(await provider.getCurrentActiveModel('session-a'), {
        model: 'gpt-5.4',
        source: 'transcript',
      });
      assert.deepEqual(await provider.getCurrentActiveModel('session-b'), {
        model: 'gpt-5.6-sol',
        source: 'transcript',
      });
      assert.equal(
        await provider.getTranscriptTurnTimestamp('session-b'),
        '2026-08-21T20:01:00.000Z',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('Codex uses a newer session pick but keeps a newer rollout turn as truth', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-model-precedence-'));
    const rolloutPath = path.join(root, 'session.jsonl');
    await writeFile(rolloutPath, JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-08-21T20:00:00.000Z',
      payload: { model: 'gpt-5.6-sol' },
    }), 'utf8');

    const picks = new Map([
      ['newer-pick', { model: 'gpt-5.4', updatedAt: '2026-08-21T20:01:00.000Z' }],
      ['older-pick', { model: 'gpt-5.4', updatedAt: '2026-08-21T19:59:00.000Z' }],
    ]);
    const modelPickStore: SessionModelPickStore = {
      getSessionModelPick: (sessionId) => picks.get(sessionId) ?? null,
      setSessionModelPick: () => true,
    };
    const provider = new CodexProviderModels({
      modelPickStore,
      lookupSessionRow: () => ({ jsonl_path: rolloutPath }),
    });

    try {
      assert.deepEqual(await provider.getCurrentActiveModel('newer-pick'), {
        model: 'gpt-5.4',
        source: 'pick',
      });
      assert.deepEqual(await provider.getCurrentActiveModel('older-pick'), {
        model: 'gpt-5.6-sol',
        source: 'transcript',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('codex-usage', () => {
  const FALLBACK_SNAPSHOT = {
    limitId: 'codex',
    limitName: 'Codex',
    primary: {
      usedPercent: 42,
      windowDurationMins: 300,
      resetsAt: 1_700_000_000,
    },
    secondary: {
      usedPercent: 71,
      windowDurationMins: 10_080,
      resetsAt: 1_700_100_000,
    },
    credits: {
      hasCredits: true,
      unlimited: false,
      balance: '12.50',
    },
    individualLimit: {
      limit: '100.00',
      used: '35.00',
      remainingPercent: 65,
      resetsAt: 1_700_200_000,
    },
  };

  test('Codex usage normalizes multi-bucket windows without duplicating the fallback snapshot', () => {
    const usage = normalizeCodexRateLimits({
      rateLimits: FALLBACK_SNAPSHOT,
      rateLimitsByLimitId: {
        codex: FALLBACK_SNAPSHOT,
        review: {
          limitId: 'review',
          limitName: 'Code review',
          primary: {
            usedPercent: 120,
            windowDurationMins: 60,
            resetsAt: null,
          },
        },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{
          id: 'reset-1',
          status: 'available',
          grantedAt: 1_700_300_000,
          expiresAt: 1_700_400_000,
          title: 'Rate-limit reset',
          description: 'Reset an eligible Codex window.',
        }],
      },
    });

    assert.deepEqual(usage.windows, [
      {
        id: 'review:primary',
        bucketId: 'review',
        label: 'Code review',
        utilization: 100,
        resetsAt: null,
        durationMinutes: 60,
      },
      {
        id: 'codex:primary',
        bucketId: 'codex',
        label: 'Codex',
        utilization: 42,
        resetsAt: '2023-11-14T22:13:20.000Z',
        durationMinutes: 300,
      },
      {
        id: 'codex:secondary',
        bucketId: 'codex',
        label: 'Codex',
        utilization: 71,
        resetsAt: '2023-11-16T02:00:00.000Z',
        durationMinutes: 10_080,
      },
    ]);
    assert.deepEqual(usage.credits, {
      kind: 'balance',
      hasCredits: true,
      unlimited: false,
      balance: '12.50',
      individualLimit: {
        limit: '100.00',
        used: '35.00',
        remainingPercent: 65,
        resetsAt: '2023-11-17T05:46:40.000Z',
      },
    });
    assert.deepEqual(usage.resetCredits, {
      availableCount: 2,
      details: [{
        id: 'reset-1',
        status: 'available',
        grantedAt: '2023-11-18T09:33:20.000Z',
        expiresAt: '2023-11-19T13:20:00.000Z',
        title: 'Rate-limit reset',
        description: 'Reset an eligible Codex window.',
      }],
    });
  });

  test('Codex usage falls back to the historical single-bucket view', () => {
    const usage = normalizeCodexRateLimits({
      rateLimits: {
        ...FALLBACK_SNAPSHOT,
        credits: {
          hasCredits: false,
          unlimited: true,
          balance: null,
        },
        individualLimit: null,
        rateLimitReachedType: 'rate_limit_reached',
      },
      rateLimitsByLimitId: null,
    });

    assert.equal(usage.windows.length, 2);
    assert.equal(usage.windows[0].label, undefined);
    assert.deepEqual(usage.credits, {
      kind: 'balance',
      hasCredits: false,
      unlimited: true,
      balance: null,
      limitReachedReason: 'rate_limit_reached',
    });
  });

  test('Codex usage normalizes account token activity separately from plan limits', () => {
    assert.deepEqual(normalizeCodexAccountActivity({
      summary: {
        lifetimeTokens: 3_160_000,
        peakDailyTokens: 850_000,
        longestRunningTurnSec: 181,
        currentStreakDays: 2,
        longestStreakDays: 7,
      },
      dailyUsageBuckets: [
        { startDate: '2026-07-23', tokens: 120_000 },
        { startDate: '2026-07-24', tokens: 850_000 },
        { startDate: null, tokens: 10 },
      ],
    }), {
      lifetimeTokens: 3_160_000,
      peakDailyTokens: 850_000,
      longestRunningTurnSeconds: 181,
      currentStreakDays: 2,
      longestStreakDays: 7,
      daily: [
        { date: '2026-07-23', tokens: 120_000 },
        { date: '2026-07-24', tokens: 850_000 },
      ],
    });

    assert.equal(normalizeCodexAccountActivity({
      summary: {
        lifetimeTokens: null,
      },
      dailyUsageBuckets: [],
    }), undefined);
  });

  test('Codex provider usage hides subscription limits for API-key auth', async () => {
    let accountUsageReads = 0;
    const provider = new CodexProviderUsage({
      readCredentials: async () => ({
        authenticated: true,
        email: 'API Key Auth',
        method: 'api_key',
      }),
      readAccountUsage: async () => {
        accountUsageReads += 1;
        return { rateLimits: {} };
      },
    });

    assert.deepEqual(await provider.getUsage(), {
      provider: 'codex',
      supported: false,
      reason: 'api_key',
    });
    assert.equal(accountUsageReads, 0);
  });

  test('Codex provider usage reports missing login without starting app-server', async () => {
    let accountUsageReads = 0;
    const provider = new CodexProviderUsage({
      readCredentials: async () => ({
        authenticated: false,
        email: null,
        method: null,
      }),
      readAccountUsage: async () => {
        accountUsageReads += 1;
        return { rateLimits: {} };
      },
    });

    assert.deepEqual(await provider.getUsage(), {
      provider: 'codex',
      supported: true,
      reason: 'not_authenticated',
      error: 'Codex CLI is not authenticated. Run codex login first.',
    });
    assert.equal(accountUsageReads, 0);
  });

  test('Codex provider usage returns normalized account limits', async () => {
    const provider = new CodexProviderUsage({
      readCredentials: async () => ({
        authenticated: true,
        email: 'codex@example.com',
        method: 'credentials_file',
      }),
      readAccountUsage: async () => ({
        rateLimits: {
          rateLimits: FALLBACK_SNAPSHOT,
          rateLimitResetCredits: {
            availableCount: 0,
            credits: [],
          },
        },
        activity: {
          summary: {
            lifetimeTokens: 3_160_000,
            peakDailyTokens: 850_000,
            longestRunningTurnSec: 181,
            currentStreakDays: 2,
            longestStreakDays: 7,
          },
          dailyUsageBuckets: null,
        },
      }),
    });

    const usage = await provider.getUsage();
    assert.equal(usage.provider, 'codex');
    assert.equal(usage.supported, true);
    assert.equal(usage.windows?.[0].durationMinutes, 300);
    assert.equal(usage.credits?.kind, 'balance');
    assert.equal(usage.resetCredits?.availableCount, 0);
    assert.equal(usage.activity?.lifetimeTokens, 3_160_000);
    assert.match(usage.fetchedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });

  test('Codex app-server client initializes before reading account limits and activity', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-usage-app-server-'));
    const fakeServerPath = path.join(tempRoot, 'fake-app-server.mjs');

    try {
      await writeFile(
        fakeServerPath,
        `import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const keepAlive = setInterval(() => {}, 1_000);
  let initialized = false;
  let accountResponses = 0;
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: message.id, result: {
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'linux',
        userAgent: 'fake'
      } }) + '\\n');
    } else if (message.method === 'initialized') {
      initialized = true;
    } else if (message.method === 'account/rateLimits/read') {
      process.stdout.write(JSON.stringify(initialized
        ? { id: message.id, result: { rateLimits: { primary: { usedPercent: 25 } } } }
        : { id: message.id, error: { code: -32000, message: 'not initialized' } }
      ) + '\\n');
      accountResponses += 1;
    } else if (message.method === 'account/usage/read') {
      process.stdout.write(JSON.stringify(initialized
        ? { id: message.id, result: { summary: { lifetimeTokens: 1234 }, dailyUsageBuckets: null } }
        : { id: message.id, error: { code: -32000, message: 'not initialized' } }
      ) + '\\n');
      accountResponses += 1;
    }
    if (accountResponses === 2) {
      clearInterval(keepAlive);
    }
  }
  `,
        'utf8',
      );

      const result = await readCodexAccountUsage({
        command: {
          command: process.execPath,
          args: [fakeServerPath],
        },
        timeoutMs: 2_000,
      });

      assert.deepEqual(result, {
        rateLimits: {
          rateLimits: {
            primary: {
              usedPercent: 25,
            },
          },
        },
        activity: {
          summary: {
            lifetimeTokens: 1234,
          },
          dailyUsageBuckets: null,
        },
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex app-server client reads every model/list page', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-models-app-server-'));
    const fakeServerPath = path.join(tempRoot, 'fake-app-server.mjs');
    try {
      await writeFile(fakeServerPath, `
  import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let initialized = false;
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      if (message.params?.capabilities?.experimentalApi !== true) process.exit(20);
      send({ id: message.id, result: { userAgent: 'fake' } });
    } else if (message.method === 'initialized') {
      initialized = true;
    } else if (message.method === 'model/list') {
      if (!initialized) process.exit(21);
      const suffix = message.params.cursor ? 'two' : 'one';
      send({ id: message.id, result: {
        data: [{
          id: 'id-' + suffix,
          model: 'model-' + suffix,
          displayName: 'Model ' + suffix,
          description: '',
          hidden: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: 'medium',
          isDefault: !message.params.cursor
        }],
        nextCursor: message.params.cursor ? null : 'page-2'
      } });
    }
  }
  `, 'utf8');
      const models = await readCodexModelList({
        command: { command: process.execPath, args: [fakeServerPath] },
        timeoutMs: 2_000,
      });
      assert.deepEqual(models.map((model) => model.model), ['model-one', 'model-two']);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
