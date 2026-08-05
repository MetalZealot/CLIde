import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import {
  CodexSessionsProvider,
  normalizeAndRedactCodexQuestionAnswers,
  normalizePersistedCodexQuestions,
} from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { extractCodexContextTokenUsage } from '@/shared/codex-token-usage.js';

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
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Fix the login redirect bug');
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
