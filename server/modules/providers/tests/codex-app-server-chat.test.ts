import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  CodexAppServerChatTransport,
  CodexAppServerStartupError,
  withCodexAppServerStartupFallback,
} from '@/modules/providers/list/codex/codex-app-server-chat.transport.js';
import {
  getCodexChatTransportDiagnostics,
  markCodexAppServerStartupFallback,
  resetCodexChatTransportStateForTests,
} from '@/modules/providers/list/codex/codex-chat-transport-state.js';
import { interactiveRequestRegistry } from '@/modules/providers/services/interactive-request-registry.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import type { PendingInteractiveRequest } from '@/shared/types.js';

type Writer = {
  messages: Array<Record<string, unknown>>;
  sessionIds: string[];
  send: (message: unknown) => void;
  setSessionId: (sessionId: string) => void;
  userId?: string;
};

const transports: CodexAppServerChatTransport[] = [];
const originalResolveResumeModel = providerModelsService.resolveResumeModel;

afterEach(() => {
  interactiveRequestRegistry.clearForTests();
  for (const transport of transports.splice(0)) {
    transport.closeForTests();
  }
  providerModelsService.resolveResumeModel = originalResolveResumeModel;
  resetCodexChatTransportStateForTests();
});

function createWriter(userId?: string): Writer {
  const writer: Writer = {
    messages: [],
    sessionIds: [],
    send: (message) => {
      writer.messages.push(message as Record<string, unknown>);
    },
    setSessionId: (sessionId) => {
      writer.sessionIds.push(sessionId);
    },
    ...(userId ? { userId } : {}),
  };
  return writer;
}

async function createFakeServer(source: string): Promise<{
  command: { command: string; args: string[] };
  cleanup: () => Promise<void>;
  root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-chat-'));
  const scriptPath = path.join(root, 'fake-app-server.mjs');
  await writeFile(scriptPath, source, 'utf8');
  return {
    command: { command: process.execPath, args: [scriptPath] },
    cleanup: () => rm(root, { recursive: true, force: true }),
    root,
  };
}

async function waitForPending(
  predicate: (request: PendingInteractiveRequest) => boolean = () => true,
): Promise<PendingInteractiveRequest> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const request = interactiveRequestRegistry
      .getPendingForSession('thread-1')
      .find(predicate);
    if (request) {
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for an App Server interactive request.');
}

const BASIC_SERVER = `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
let threadNumber = 0;
let pendingThread = null;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (message.params?.capabilities?.experimentalApi !== true) process.exit(11);
    send({ id: message.id, result: { userAgent: 'fake' } });
  } else if (message.method === 'initialized') {
    initialized = true;
  } else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    if (!initialized) process.exit(12);
    threadNumber += 1;
    const id = message.method === 'thread/resume' ? message.params.threadId : 'thread-' + threadNumber;
    pendingThread = { method: message.method, params: message.params, id };
    send({ id: message.id, result: {
      thread: { id, sessionId: id, path: null, cwd: message.params.cwd },
      model: message.params.model || 'default',
      cwd: message.params.cwd,
      reasoningEffort: null
    } });
  } else if (message.method === 'turn/start') {
    const turnId = 'turn-' + threadNumber;
    const capture = { thread: pendingThread, turn: message.params };
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', error: null } } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'agentMessage', id: 'capture-' + turnId, text: 'CAPTURE:' + JSON.stringify(capture) }
    } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'commandExecution', id: 'cmd-' + turnId, command: 'pwd', cwd: message.params.cwd,
        status: 'completed', aggregatedOutput: message.params.cwd + '\\n', exitCode: 0 }
    } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'fileChange', id: 'file-' + turnId,
        changes: [{ path: 'a.txt', kind: 'update', diff: '+hello' }], status: 'completed' }
    } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'mcpToolCall', id: 'mcp-' + turnId, server: 'demo', tool: 'lookup',
        status: 'completed', arguments: { q: 1 }, result: { ok: true }, error: null }
    } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'webSearch', id: 'web-' + turnId, query: 'CLIde' }
    } });
    send({ method: 'thread/tokenUsage/updated', params: {
      threadId: pendingThread.id, turnId,
      tokenUsage: {
        total: { totalTokens: 99, inputTokens: 80, cachedInputTokens: 10, cacheWriteInputTokens: 2, outputTokens: 19, reasoningOutputTokens: 2 },
        last: { totalTokens: 23, inputTokens: 20, cachedInputTokens: 4, cacheWriteInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 1 },
        modelContextWindow: 1000
      }
    } });
    send({ method: 'turn/completed', params: {
      threadId: pendingThread.id, turn: { id: turnId, status: 'completed', error: null }
    } });
    send({ method: 'turn/completed', params: {
      threadId: pendingThread.id, turn: { id: turnId, status: 'completed', error: null }
    } });
  }
}`;

test('App Server initializes before work and maps new/resumed turns, Plan, inputs, items, and usage', async () => {
  const fake = await createFakeServer(BASIC_SERVER);
  const imagePath = path.join(fake.root, 'image.png');
  await writeFile(imagePath, 'not-read-by-adapter', 'utf8');
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async (_provider, _sessionId, requested) => requested || undefined;

  try {
    const first = createWriter();
    await transport.query('Inspect this', {
      cwd: fake.root,
      model: 'gpt-test',
      effort: 'high',
      permissionMode: 'plan',
      images: [{ path: imagePath }],
    }, first);

    assert.deepEqual(first.sessionIds, ['thread-1']);
    const firstCaptureMessage = first.messages.find((message) =>
      message.kind === 'text' && String(message.content).startsWith('CAPTURE:'));
    assert.ok(firstCaptureMessage);
    const firstCapture = JSON.parse(String(firstCaptureMessage.content).slice(8));
    assert.equal(firstCapture.thread.method, 'thread/start');
    assert.equal(firstCapture.thread.params.model, 'gpt-test');
    assert.equal(firstCapture.thread.params.approvalPolicy, 'untrusted');
    assert.deepEqual(firstCapture.turn.input, [
      { type: 'text', text: 'Inspect this', text_elements: [] },
      { type: 'localImage', path: imagePath },
    ]);
    assert.equal(firstCapture.turn.effort, 'high');
    assert.equal(firstCapture.turn.collaborationMode.mode, 'plan');
    assert.equal(firstCapture.turn.sandboxPolicy.type, 'workspaceWrite');

    assert.ok(first.messages.some((message) => message.kind === 'tool_use' && message.toolName === 'Bash'));
    assert.ok(first.messages.some((message) => message.kind === 'tool_use' && message.toolName === 'FileChanges'));
    assert.ok(first.messages.some((message) => message.kind === 'tool_use' && message.toolName === 'lookup'));
    assert.ok(first.messages.some((message) => message.kind === 'tool_use' && message.toolName === 'WebSearch'));
    const budget = first.messages.find((message) => message.kind === 'status');
    assert.deepEqual(budget?.tokenBudget, {
      used: 23,
      total: 1000,
      inputTokens: 20,
      outputTokens: 3,
      breakdown: { input: 20, output: 3 },
    });
    assert.equal(first.messages.filter((message) => message.kind === 'complete').length, 1);

    const resumed = createWriter();
    await transport.query('Continue', {
      sessionId: 'stable-thread',
      cwd: fake.root,
      model: 'gpt-resume',
      permissionMode: 'acceptEdits',
    }, resumed);
    assert.deepEqual(resumed.sessionIds, ['stable-thread']);
    const resumedCaptureMessage = resumed.messages.find((message) =>
      message.kind === 'text' && String(message.content).startsWith('CAPTURE:'));
    const resumedCapture = JSON.parse(String(resumedCaptureMessage?.content).slice(8));
    assert.equal(resumedCapture.thread.method, 'thread/resume');
    assert.equal(resumedCapture.thread.params.threadId, 'stable-thread');
    assert.equal(resumedCapture.turn.approvalPolicy, 'never');
    assert.equal(resumedCapture.turn.collaborationMode, undefined);
    assert.equal(resumed.messages.filter((message) => message.kind === 'complete').length, 1);
  } finally {
    await fake.cleanup();
  }
});

test('App Server completion reaches the notification orchestrator with Chat identity', async () => {
  const fake = await createFakeServer(BASIC_SERVER);
  const stopped: unknown[] = [];
  const transport = new CodexAppServerChatTransport({
    command: fake.command,
    trackRuntimeState: true,
    notifyRunStopped: (payload) => {
      stopped.push(payload);
    },
  });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';

  try {
    await transport.query('Notify me', {
      cwd: fake.root,
      sessionSummary: 'Notification parity',
    }, createWriter('user-42'));

    assert.deepEqual(stopped, [{
      userId: 'user-42',
      provider: 'codex',
      sessionId: 'thread-1',
      sessionName: 'Notification parity',
      stopReason: 'completed',
    }]);
    assert.equal(getCodexChatTransportDiagnostics().actual, 'app-server');
    assert.equal(getCodexChatTransportDiagnostics().health, 'ready');
  } finally {
    await fake.cleanup();
  }
});

const FORK_SERVER = `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingThread = null;
let childNumber = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const sourceTurns = [
  { id: 'turn-a', status: 'completed', items: [], error: null },
  { id: 'turn-b', status: 'completed', items: [], error: null },
  { id: 'turn-c', status: 'completed', items: [], error: null },
];
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake' } });
  } else if (message.method === 'initialized') {
    // notification
  } else if (message.method === 'thread/resume') {
    pendingThread = { method: message.method, params: message.params, id: message.params.threadId };
    send({ id: message.id, result: {
      thread: {
        id: message.params.threadId,
        sessionId: 'tree-1',
        path: '/tmp/source.jsonl',
        cwd: message.params.cwd,
        turns: sourceTurns
      },
      model: message.params.model || 'default',
      cwd: message.params.cwd,
      reasoningEffort: null
    } });
  } else if (message.method === 'thread/fork') {
    childNumber += 1;
    const id = 'fork-' + childNumber;
    pendingThread = { method: message.method, params: message.params, id };
    send({ id: message.id, result: {
      thread: {
        id,
        sessionId: 'tree-1',
        forkedFromId: message.params.threadId,
        path: '/tmp/' + id + '-' + (
          message.params.beforeTurnId
            ? 'before-' + message.params.beforeTurnId
            : message.params.lastTurnId
              ? 'through-' + message.params.lastTurnId
              : 'all'
        ) + '.jsonl',
        cwd: message.params.cwd,
        turns: sourceTurns
      },
      model: message.params.model || 'default',
      cwd: message.params.cwd,
      reasoningEffort: null
    } });
  } else if (message.method === 'thread/start') {
    childNumber += 1;
    const id = 'fresh-' + childNumber;
    pendingThread = { method: message.method, params: message.params, id };
    send({ id: message.id, result: {
      thread: { id, sessionId: id, path: '/tmp/' + id + '.jsonl', cwd: message.params.cwd, turns: [] },
      model: message.params.model || 'default',
      cwd: message.params.cwd,
      reasoningEffort: null
    } });
  } else if (message.method === 'turn/start') {
    const turnId = 'replacement-turn';
    const capture = { thread: pendingThread, turn: message.params };
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', error: null } } });
    send({ method: 'item/completed', params: {
      threadId: pendingThread.id, turnId, completedAtMs: Date.now(),
      item: { type: 'agentMessage', id: 'capture', text: 'CAPTURE:' + JSON.stringify(capture) }
    } });
    send({ method: 'turn/completed', params: {
      threadId: pendingThread.id, turn: { id: turnId, status: 'completed', error: null }
    } });
  }
}`;

test('Codex rewind forks before the selected turn and remaps the writer to the child', async () => {
  const fake = await createFakeServer(FORK_SERVER);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';

  try {
    const writer = createWriter();
    await transport.query('Edited second prompt', {
      sessionId: 'source-thread',
      rewindToMessageId: 'turn-b',
      cwd: fake.root,
    }, writer);

    assert.deepEqual(writer.sessionIds, ['fork-1']);
    const captureMessage = writer.messages.find((message) =>
      message.kind === 'text' && String(message.content).startsWith('CAPTURE:'));
    const capture = JSON.parse(String(captureMessage?.content).slice(8));
    assert.equal(capture.thread.method, 'thread/fork');
    assert.equal(capture.thread.params.threadId, 'source-thread');
    assert.equal(capture.thread.params.beforeTurnId, 'turn-b');
    assert.equal(capture.thread.params.lastTurnId, undefined);
    assert.equal(capture.turn.threadId, 'fork-1');
  } finally {
    await fake.cleanup();
  }
});

test('Codex first-message rewind forks before the first turn and explicit fork starts no turn', async () => {
  const fake = await createFakeServer(FORK_SERVER);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';

  try {
    const writer = createWriter();
    await transport.query('Edited first prompt', {
      sessionId: 'source-thread',
      rewindToMessageId: 'turn-a',
      cwd: fake.root,
    }, writer);

    assert.deepEqual(writer.sessionIds, ['fork-1']);
    const captureMessage = writer.messages.find((message) =>
      message.kind === 'text' && String(message.content).startsWith('CAPTURE:'));
    const capture = JSON.parse(String(captureMessage?.content).slice(8));
    assert.equal(capture.thread.method, 'thread/fork');
    assert.equal(capture.thread.params.threadId, 'source-thread');
    assert.equal(capture.thread.params.beforeTurnId, 'turn-a');

    const child = await transport.forkThread('source-thread', {
      cwd: fake.root,
      lastTurnId: 'turn-b',
    });
    assert.equal(child.id, 'fork-2');
    assert.equal(child.forkedFromId, 'source-thread');
    assert.equal(child.path, '/tmp/fork-2-through-turn-b.jsonl');
  } finally {
    await fake.cleanup();
  }
});

const INTERACTIVE_SERVER = `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
let stage = 0;
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: {
    thread: { id: 'thread-1', sessionId: 'thread-1', path: null, cwd: message.params.cwd },
    model: 'gpt-test', cwd: message.params.cwd, reasoningEffort: null
  } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', error: null } } });
    send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1',
      item: { type: 'fileChange', id: 'file-1', changes: [{ path: 'src/a.ts', kind: 'update', diff: '+safe' }], status: 'inProgress' }
    } });
    send({ id: 'question-1', method: 'item/tool/requestUserInput', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'question-item',
      questions: [
        { id: 'choice', header: 'Choice', question: 'Pick one', isOther: true, isSecret: false,
          options: [{ label: 'A', description: 'First' }, { label: 'B', description: 'Second' }] },
        { id: 'secret', header: 'Secret', question: 'Token', isOther: false, isSecret: true, options: null }
      ], autoResolutionMs: null
    } });
  } else if (message.id === 'question-1') {
    if (message.result?.answers?.choice?.answers?.[0] !== 'custom answer') process.exit(31);
    if (message.result?.answers?.secret?.answers?.[0] !== 'top-secret') process.exit(32);
    stage = 1;
    send({ id: 'command-1', method: 'item/commandExecution/requestApproval', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', startedAtMs: 1,
      command: 'curl https://example.test', cwd: '/workspace', reason: 'Need metadata',
      networkApprovalContext: { host: 'example.test', protocol: 'https' }
    } });
  } else if (message.id === 'command-1') {
    if (message.result?.decision !== 'acceptForSession') process.exit(33);
    stage = 2;
    send({ id: 'file-approval', method: 'item/fileChange/requestApproval', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-1', startedAtMs: 2,
      reason: 'Apply update', grantRoot: '/workspace'
    } });
  } else if (message.id === 'file-approval') {
    if (message.result?.decision !== 'decline') process.exit(34);
    stage = 3;
    send({ id: 'permissions-1', method: 'item/permissions/requestApproval', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'perm-1', startedAtMs: 3,
      cwd: '/workspace', reason: 'Read dependency',
      permissions: { network: { enabled: true }, fileSystem: { read: ['/opt/data'], write: null, globScanMaxDepth: 4 } }
    } });
  } else if (message.id === 'permissions-1') {
    if (message.result?.scope !== 'turn' || message.result?.permissions?.network?.enabled !== true) process.exit(35);
    if (message.result?.permissions?.fileSystem?.read?.[0] !== '/opt/data') process.exit(36);
    stage = 4;
    send({ id: 'command-cancel', method: 'item/commandExecution/requestApproval', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-2', startedAtMs: 4,
      command: 'false', cwd: '/workspace', reason: null, networkApprovalContext: null
    } });
  } else if (message.id === 'command-cancel') {
    if (message.result?.decision !== 'cancel' || stage !== 4) process.exit(37);
    send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
      completedAtMs: Date.now(), item: { type: 'agentMessage', id: 'done', text: 'interactive-complete' }
    } });
    send({ method: 'turn/completed', params: {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null }
    } });
  }
}`;

test('App Server validates questions and maps every approval response without exposing secrets', async () => {
  providerModelsService.resolveResumeModel = async () => 'gpt-test';
  const completeFake = await createFakeServer(INTERACTIVE_SERVER);
  const completeTransport = new CodexAppServerChatTransport({ command: completeFake.command });
  transports.push(completeTransport);
  const completeWriter = createWriter();
  try {
    const query = completeTransport.query('interactive', { cwd: completeFake.root }, completeWriter);
    const question = await waitForPending((request) => request.requestType === 'user_input');
    assert.equal(question.questions?.[0].id, 'choice');
    assert.equal(question.questions?.[0].options[0].description, 'First');
    assert.equal(question.questions?.[1].isSecret, true);
    const unknown = await interactiveRequestRegistry.resolve(question.requestId, {
      requestType: 'user_input',
      answers: { missing: ['x'] },
    });
    assert.equal(unknown.status, 'invalid');
    assert.ok(interactiveRequestRegistry.get(question.requestId));
    assert.equal((await interactiveRequestRegistry.resolve(question.requestId, {
      requestType: 'user_input',
      answers: { choice: ['custom answer'], secret: ['top-secret'] },
    })).status, 'resolved');

    const command = await waitForPending((request) => request.requestType === 'command_approval');
    assert.deepEqual(command.input, {
      command: 'curl https://example.test',
      cwd: '/workspace',
      reason: 'Need metadata',
      networkDestination: { host: 'example.test', protocol: 'https' },
    });
    assert.equal((await interactiveRequestRegistry.resolve(command.requestId, {
      requestType: 'command_approval',
      decision: 'allow_session',
    })).status, 'resolved');

    const file = await waitForPending((request) => request.requestType === 'file_change_approval');
    assert.deepEqual((file.input as { changes: unknown }).changes, [
      { path: 'src/a.ts', kind: 'update', diff: '+safe' },
    ]);
    assert.equal((await interactiveRequestRegistry.resolve(file.requestId, {
      requestType: 'file_change_approval',
      decision: 'deny',
    })).status, 'resolved');

    const permissions = await waitForPending((request) => request.requestType === 'permission_approval');
    assert.equal((await interactiveRequestRegistry.resolve(permissions.requestId, {
      requestType: 'permission_approval',
      decision: 'allow_once',
    })).status, 'resolved');

    const cancel = await waitForPending((request) =>
      request.requestType === 'command_approval'
      && (request.input as { command?: string }).command === 'false');
    assert.equal((await interactiveRequestRegistry.resolve(cancel.requestId, {
      requestType: 'command_approval',
      decision: 'cancel',
    })).status, 'resolved');

    await query;
    assert.ok(completeWriter.messages.some((message) => message.content === 'interactive-complete'));
    assert.equal(completeWriter.messages.filter((message) => message.kind === 'complete').length, 1);
    assert.ok(!JSON.stringify(completeWriter.messages).includes('top-secret'));
  } finally {
    await completeFake.cleanup();
  }
});

test('App Server timeout submits an empty answer map', async () => {
  const fake = await createFakeServer(`
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: {
    thread: { id: 'thread-1', sessionId: 'thread-1', path: null, cwd: '/tmp' },
    model: 'gpt-test', cwd: '/tmp', reasoningEffort: null
  } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', error: null } } });
    send({ id: 'timeout-question', method: 'item/tool/requestUserInput', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'q',
      questions: [{ id: 'q', header: '', question: 'Optional?', isOther: true, isSecret: false, options: null }],
      autoResolutionMs: 30
    } });
  } else if (message.id === 'timeout-question') {
    if (Object.keys(message.result?.answers || {}).length !== 0) process.exit(41);
    send({ method: 'turn/completed', params: {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null }
    } });
  }
}`);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';
  const writer = createWriter();
  try {
    await transport.query('timeout', { cwd: fake.root }, writer);
    assert.deepEqual(interactiveRequestRegistry.getPendingForSession('thread-1'), []);
    assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 1);
  } finally {
    await fake.cleanup();
  }
});

test('App Server process exit fails an accepted turn and a later query starts a fresh process', async () => {
  const fake = await createFakeServer(`
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: {
    thread: { id: 'thread-1', sessionId: 'thread-1', path: null, cwd: '/tmp' },
    model: 'gpt-test', cwd: '/tmp', reasoningEffort: null
  } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', error: null } } });
    process.exit(17);
  }
}`);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';
  try {
    const first = createWriter();
    await transport.query('first', { cwd: fake.root }, first);
    assert.ok(first.messages.some((message) => message.kind === 'error' && String(message.content).includes('code 17')));
    assert.equal(first.messages.filter((message) => message.kind === 'complete').length, 1);

    const second = createWriter();
    await transport.query('second', { cwd: fake.root }, second);
    assert.ok(second.messages.some((message) => message.kind === 'error' && String(message.content).includes('code 17')));
    assert.equal(second.messages.filter((message) => message.kind === 'complete').length, 1);
  } finally {
    await fake.cleanup();
  }
});

test('App Server abort interrupts the active turn and cancels pending interactions', async () => {
  const fake = await createFakeServer(`
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: {
    thread: { id: 'thread-1', sessionId: 'thread-1', path: null, cwd: '/tmp' },
    model: 'gpt-test', cwd: '/tmp', reasoningEffort: null
  } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', error: null } } });
    send({ id: 'pending-question', method: 'item/tool/requestUserInput', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'q',
      questions: [{ id: 'q', header: '', question: 'Wait?', isOther: true, isSecret: false, options: null }],
      autoResolutionMs: null
    } });
  } else if (message.method === 'turn/interrupt') {
    if (message.params.threadId !== 'thread-1' || message.params.turnId !== 'turn-1') process.exit(51);
    send({ id: message.id, result: {} });
    send({ method: 'turn/completed', params: {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null }
    } });
  }
}`);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';
  const writer = createWriter();
  try {
    const query = transport.query('abort', { cwd: fake.root }, writer);
    await waitForPending();
    assert.equal(await transport.abort('thread-1'), true);
    await query;
    assert.equal(transport.isActive('thread-1'), false);
    assert.deepEqual(interactiveRequestRegistry.getPendingForSession('thread-1'), []);
    // The websocket gateway owns the immediate aborted completion.
    assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 0);
  } finally {
    await fake.cleanup();
  }
});

test('App Server rejects malformed and unsupported server requests without hanging the turn', async () => {
  const fake = await createFakeServer(`
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: {
    thread: { id: 'thread-1', sessionId: 'thread-1', path: null, cwd: '/tmp' },
    model: 'gpt-test', cwd: '/tmp', reasoningEffort: null
  } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', error: null } } });
    send({ id: 'malformed', method: 'item/tool/requestUserInput', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'q', questions: [], autoResolutionMs: null
    } });
  } else if (message.id === 'malformed') {
    if (message.error?.code !== -32602) process.exit(61);
    send({ id: 'unsupported', method: 'mcpServer/elicitation/request', params: {
      threadId: 'thread-1', turnId: 'turn-1'
    } });
  } else if (message.id === 'unsupported') {
    if (message.error?.code !== -32601) process.exit(62);
    send({ method: 'turn/completed', params: {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null
    } } });
  }
}`);
  const transport = new CodexAppServerChatTransport({ command: fake.command });
  transports.push(transport);
  providerModelsService.resolveResumeModel = async () => 'gpt-test';
  const writer = createWriter();
  try {
    await transport.query('reject safely', { cwd: fake.root }, writer);
    assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 1);
    assert.deepEqual(interactiveRequestRegistry.getPendingForSession('thread-1'), []);
  } finally {
    await fake.cleanup();
  }
});

test('Codex SDK fallback is startup-only', async () => {
  let appCalls = 0;
  let sdkCalls = 0;
  await withCodexAppServerStartupFallback(
    async () => {
      appCalls += 1;
      throw new CodexAppServerStartupError('not initialized');
    },
    async () => {
      sdkCalls += 1;
    },
  );
  assert.equal(appCalls, 1);
  assert.equal(sdkCalls, 1);

  await assert.rejects(withCodexAppServerStartupFallback(
    async () => {
      appCalls += 1;
      throw new Error('accepted turn failed');
    },
    async () => {
      sdkCalls += 1;
    },
  ), /accepted turn failed/);
  assert.equal(appCalls, 2);
  assert.equal(sdkCalls, 1);
});

test('shared transport state records a real App Server initialization failure', async () => {
  const fake = await createFakeServer(`
process.stdin.resume();
process.stdin.once('data', () => process.exit(17));
`);
  const transport = new CodexAppServerChatTransport({
    command: fake.command,
    trackRuntimeState: true,
  });
  transports.push(transport);

  try {
    await assert.rejects(
      transport.query('Do not run', { cwd: fake.root }, createWriter()),
      CodexAppServerStartupError,
    );
    assert.equal(getCodexChatTransportDiagnostics().configured, 'app-server');
    assert.equal(getCodexChatTransportDiagnostics().actual, 'sdk');
    assert.equal(getCodexChatTransportDiagnostics().health, 'fallback');
    assert.match(getCodexChatTransportDiagnostics().lastError || '', /initialize Codex App Server/);
  } finally {
    await fake.cleanup();
  }
});

test('Codex App Server is the default and sdk is the explicit capability escape hatch', () => {
  const previous = process.env.CLIDE_CODEX_CHAT_TRANSPORT;
  try {
    delete process.env.CLIDE_CODEX_CHAT_TRANSPORT;
    assert.deepEqual(
      providerCapabilitiesService.getProviderCapabilities('codex').permissionModes,
      ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    );
    assert.equal(
      providerCapabilitiesService.getProviderCapabilities('codex').supportsPermissionRequests,
      true,
    );
    assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsRewind, true);
    assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsFork, true);
    assert.equal(getCodexChatTransportDiagnostics().sdkVersion, '0.145.0');
    assert.equal(getCodexChatTransportDiagnostics().bundledCliVersion, '0.145.0');
    assert.deepEqual(
      getCodexChatTransportDiagnostics(),
      {
        configured: 'app-server',
        actual: 'app-server',
        health: 'idle',
        sdkVersion: '0.145.0',
        bundledCliVersion: '0.145.0',
        lastError: null,
        lastStartupFallbackAt: null,
      },
    );

    process.env.CLIDE_CODEX_CHAT_TRANSPORT = 'sdk';
    assert.deepEqual(
      providerCapabilitiesService.getProviderCapabilities('codex').permissionModes,
      ['default', 'acceptEdits', 'bypassPermissions'],
    );
    assert.equal(
      providerCapabilitiesService.getProviderCapabilities('codex').supportsPermissionRequests,
      false,
    );
    assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsRewind, false);
    assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsFork, false);
    assert.equal(getCodexChatTransportDiagnostics().health, 'disabled');

    process.env.CLIDE_CODEX_CHAT_TRANSPORT = 'app-server';
    assert.equal(
      providerCapabilitiesService.getProviderCapabilities('codex').supportsPermissionRequests,
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.CLIDE_CODEX_CHAT_TRANSPORT;
    else process.env.CLIDE_CODEX_CHAT_TRANSPORT = previous;
  }
});

test('Codex startup fallback is reflected in actual transport and runtime capabilities', () => {
  const previous = process.env.CLIDE_CODEX_CHAT_TRANSPORT;
  try {
    delete process.env.CLIDE_CODEX_CHAT_TRANSPORT;
    markCodexAppServerStartupFallback(new Error('startup failed'));

    const capabilities = providerCapabilitiesService.getProviderCapabilities('codex');
    assert.equal(capabilities.supportsPermissionRequests, false);
    assert.equal(capabilities.supportsRewind, false);
    assert.equal(capabilities.supportsFork, false);
    assert.equal(capabilities.chatTransport?.configured, 'app-server');
    assert.equal(capabilities.chatTransport?.actual, 'sdk');
    assert.equal(capabilities.chatTransport?.health, 'fallback');
    assert.equal(capabilities.chatTransport?.lastError, 'startup failed');
    assert.ok(capabilities.chatTransport?.lastStartupFallbackAt);
  } finally {
    if (previous === undefined) delete process.env.CLIDE_CODEX_CHAT_TRANSPORT;
    else process.env.CLIDE_CODEX_CHAT_TRANSPORT = previous;
  }
});
