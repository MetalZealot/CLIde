import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { interactiveRequestRegistry } from '@/modules/providers/services/interactive-request-registry.service.js';
import { ProviderNativeRuntimeService } from '@/modules/providers/services/provider-native-runtime.service.js';
import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import type { IProvider, IProviderRuntime } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderNativeRuntimeDescriptor } from '@/shared/types.js';

describe('provider-runtime.service', () => {
  function createRuntime(overrides: Partial<IProviderRuntime> = {}): IProviderRuntime {
    return {
      async run() {
        return undefined;
      },
      abort() {
        return false;
      },
      ...overrides,
    };
  }

  function createProvider(id: LLMProvider, runtime: IProviderRuntime): IProvider {
    return {
      id,
      runtime,
      auth: {
        async getStatus() {
          return {
            provider: id,
            installed: true,
            authenticated: true,
            method: 'test',
            details: {},
          };
        },
      },
      sessions: {
        normalizeMessage(raw: unknown, sessionId: string | null) {
          return [{ kind: 'assistant', content: String(raw), sessionId, provider: id }];
        },
        async fetchHistory() {
          return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
        },
      },
    } as unknown as IProvider;
  }

  function createService(providers: IProvider[]) {
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
    return createProviderRuntimeService({
      listProviders: () => providers,
      resolveProvider(providerName) {
        const provider = providerMap.get(providerName as LLMProvider);
        if (!provider) {
          throw new Error(`Missing provider: ${providerName}`);
        }
        return provider;
      },
      resolveProviderSessionId: (sessionId) => sessionId ? `native-${sessionId}` : null,
      async resolveResumeModel(_provider, _sessionId, requestedModel) {
        return requestedModel?.trim() || undefined;
      },
      async getProviderModels() {
        return {
          models: { OPTIONS: [], DEFAULT: 'default-model' },
          cache: {
            updatedAt: new Date(0).toISOString(),
            expiresAt: new Date(0).toISOString(),
            source: 'fresh',
          },
        };
      },
    });
  }

  test('providerRegistry owns one runtime for every registered provider', () => {
    const providers = providerRegistry.listProviders();

    assert.deepEqual(providers.map((provider) => provider.id), [
      'claude',
      'codex',
      'cursor',
      'opencode',
    ]);
    assert.equal(providers.every((provider) => typeof provider.runtime.run === 'function'), true);
    assert.equal(providers.every((provider) => typeof provider.runtime.abort === 'function'), true);
  });

  test('dispatches runs, steering, and aborts through the runtime owned by providerRegistry', async () => {
    const calls: unknown[][] = [];
    const runtime = createRuntime({
      async run(command, options, writer, context) {
        calls.push(['run', command, options, writer]);
        assert.equal(context.resolveProviderSessionId('session-1'), 'native-session-1');
        assert.equal(await context.resolveResumeModel('session-1', 'sonnet'), 'sonnet');
        assert.deepEqual(await context.getProviderModels(), { OPTIONS: [], DEFAULT: 'default-model' });
        assert.equal(context.normalizeMessage('hello', 'session-1')[0]?.provider, 'claude');
        assert.equal(await context.isProviderInstalled(), true);
        return 'complete';
      },
      async abort(sessionId) {
        calls.push(['abort', sessionId]);
        return true;
      },
      async steer(sessionId, content) {
        calls.push(['steer', sessionId, content]);
        return true;
      },
    });
    const service = createService([createProvider('claude', runtime)]);
    const writer = { send() {} };

    assert.equal(service.hasRuntime('claude'), true);
    assert.equal(service.hasRuntime('unknown'), false);
    assert.equal(await service.getRunner('claude')('hello', { model: 'sonnet' }, writer), 'complete');
    assert.equal(await service.steer('claude', 'session-1', 'one more detail'), true);
    assert.equal(await service.abort('claude', 'session-1'), true);
    assert.deepEqual(calls, [
      ['run', 'hello', { model: 'sonnet' }, writer],
      ['steer', 'session-1', 'one more detail'],
      ['abort', 'session-1'],
    ]);
  });

  test('reports steering as unsupported when a runtime omits it', async () => {
    const service = createService([createProvider('cursor', createRuntime())]);
    assert.equal(await service.steer('cursor', 'session-1', 'detail'), false);
  });

  test('a side question reaches the runtime with the app session id and its context', async () => {
    const runtime = createRuntime({
      async askSideQuestion(sessionId, request, context) {
        assert.equal(sessionId, 'session-1');
        assert.equal(context.resolveProviderSessionId(sessionId), 'native-session-1');
        return { answer: `asked: ${request.question}` };
      },
    });
    const service = createService([createProvider('claude', runtime)]);

    assert.deepEqual(
      await service.askSideQuestion('claude', 'session-1', { question: 'which file?' }),
      { answer: 'asked: which file?' },
    );
  });

  test('a provider with no side-question mechanism answers null rather than throwing', async () => {
    const service = createService([createProvider('cursor', createRuntime())]);
    assert.equal(await service.askSideQuestion('cursor', 'session-1', { question: 'why?' }), null);
  });

  test('routes interactive responses through provider-owned runtime capabilities', async () => {
    const decisions: unknown[][] = [];
    const claudeRuntime = createRuntime({
      permissions: {
        resolve(requestId, decision) {
          decisions.push([requestId, decision]);
          return { status: 'resolved' as const };
        },
        listPending(sessionId) {
          return [{ requestId: 'request-1', sessionId }];
        },
      },
    });
    const service = createService([
      createProvider('claude', claudeRuntime),
      createProvider('cursor', createRuntime()),
    ]);
    const decision = { allow: true, message: 'approved' };

    const result = await service.resolveInteractiveRequest('request-1', decision);

    assert.deepEqual(result, { status: 'resolved' });
    assert.deepEqual(decisions, [['request-1', decision]]);
    assert.deepEqual(service.getPendingApprovalsForSession('session-1'), [
      { requestId: 'request-1', sessionId: 'session-1' },
    ]);
  });

  test('a request no runtime owns resolves as not_found rather than silently succeeding', async () => {
    const service = createService([
      createProvider('claude', createRuntime({
        permissions: {
          resolve: () => ({ status: 'not_found' as const }),
          listPending: () => [],
        },
      })),
      createProvider('cursor', createRuntime()),
    ]);

    assert.deepEqual(
      await service.resolveInteractiveRequest('stale-request', { allow: true }),
      { status: 'not_found' },
    );
  });
});

describe('provider-native-runtime', () => {
  const makeExecutable = async (filePath: string, version: string): Promise<void> => {
    await writeFile(filePath, version, { mode: 0o700 });
    await chmod(filePath, 0o700);
  };

  test('native runtime discovery seeds bundled, deduplicates symlinks, and persists promotion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clide-native-runtime-'));
    const storePath = path.join(root, 'state', 'provider-runtimes.json');
    const bundledPath = path.join(root, 'bundled-codex');
    const externalPath = path.join(root, 'external-codex');
    const linkedPath = path.join(root, 'linked-codex');
    await makeExecutable(bundledPath, '0.147.0');
    await makeExecutable(externalPath, '0.148.0');
    await symlink(externalPath, linkedPath);

    const descriptor: ProviderNativeRuntimeDescriptor = {
      provider: 'codex',
      executableName: 'not-on-path-clide-codex',
      configuredPathEnvVar: 'CLIDE_TEST_CODEX_PATH',
      resolveBundledExecutablePath: async () => bundledPath,
      readVersion: async (executablePath) => readFile(executablePath, 'utf8'),
      checkCompatibility: async () => 'compatible',
    };
    const service = new ProviderNativeRuntimeService(descriptor, {
      storePath,
      homeDirectory: root,
      env: { PATH: root, CLIDE_TEST_CODEX_PATH: linkedPath },
    });

    try {
      const installations = await service.listInstallations();
      assert.equal(installations.length, 2);
      const external = installations.find((installation) => installation.version === '0.148.0');
      assert.ok(external);
      assert.equal(external.realPath, externalPath);
      assert.deepEqual(external.sources, ['configured']);

      const seeded = await service.getActiveRuntime();
      assert.equal(seeded.bundled, true);
      assert.equal(seeded.version, '0.147.0');
      assert.equal((await lstat(storePath)).mode & 0o777, 0o600);

      const promoted = await service.selectInstallation(external.id);
      assert.equal(promoted.realPath, externalPath);
      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        providers: { codex: { active: { realPath: string }; previous: { realPath: string } } };
      };
      assert.equal(persisted.providers.codex.active.realPath, externalPath);
      assert.equal(persisted.providers.codex.previous.realPath, bundledPath);
      const state = await service.getRuntimeState();
      assert.equal(state.active?.id, external.id);
      assert.equal(state.previous?.id, seeded.id);
      assert.equal((await service.getInstallation(seeded.id))?.realPath, bundledPath);

      const reloaded = new ProviderNativeRuntimeService(descriptor, {
        storePath,
        homeDirectory: root,
        env: { PATH: '' },
      });
      assert.equal((await reloaded.getActiveRuntime()).realPath, externalPath);

      await rm(externalPath);
      await assert.rejects(
        reloaded.getActiveRuntime(),
        /selected codex runtime is missing or changed/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('native runtime selection rejects an incompatible discovered installation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clide-native-runtime-'));
    const bundledPath = path.join(root, 'bundled-codex');
    const incompatiblePath = path.join(root, 'incompatible-codex');
    await makeExecutable(bundledPath, '0.147.0');
    await makeExecutable(incompatiblePath, '9.0.0');
    const descriptor: ProviderNativeRuntimeDescriptor = {
      provider: 'codex',
      executableName: 'not-on-path-clide-codex',
      configuredPathEnvVar: 'CLIDE_TEST_CODEX_PATH',
      resolveBundledExecutablePath: async () => bundledPath,
      readVersion: async (executablePath) => readFile(executablePath, 'utf8'),
      checkCompatibility: async (executablePath) => (
        executablePath === incompatiblePath ? 'incompatible' : 'compatible'
      ),
    };
    const service = new ProviderNativeRuntimeService(descriptor, {
      storePath: path.join(root, 'provider-runtimes.json'),
      homeDirectory: root,
      env: { PATH: '', CLIDE_TEST_CODEX_PATH: incompatiblePath },
    });

    try {
      const incompatible = (await service.listInstallations())
        .find((installation) => installation.realPath === incompatiblePath);
      assert.ok(incompatible);
      await assert.rejects(
        service.selectInstallation(incompatible.id),
        /compatibility incompatible/,
      );
      assert.equal((await service.getActiveRuntime()).bundled, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('interactive-request-registry', () => {
  const baseRequest = {
    requestId: 'request-1',
    provider: 'codex' as const,
    sessionId: 'thread-1',
    requestType: 'user_input' as const,
    toolName: 'request_user_input',
    receivedAt: new Date().toISOString(),
  };

  test.afterEach(() => {
    interactiveRequestRegistry.clearForTests();
  });

  test('interactive registry replays pending requests and accepts exactly one response', async () => {
    const responses: unknown[] = [];
    interactiveRequestRegistry.register(baseRequest, {
      onResponse: (response) => {
        responses.push(response);
      },
    });

    assert.deepEqual(
      interactiveRequestRegistry.getPendingForSession('thread-1'),
      [baseRequest],
    );

    const first = await interactiveRequestRegistry.resolve('request-1', {
      decision: 'allow_once',
      answers: { question: ['One'] },
    });
    const duplicate = await interactiveRequestRegistry.resolve('request-1', {
      decision: 'deny',
    });

    assert.equal(first.status, 'resolved');
    assert.equal(duplicate.status, 'not_found');
    assert.deepEqual(responses, [{
      decision: 'allow_once',
      answers: { question: ['One'] },
    }]);
  });

  test('interactive registry keeps malformed responses pending for correction', async () => {
    interactiveRequestRegistry.register(baseRequest, {
      onResponse: () => {
        throw new Error('bad answer');
      },
    });

    assert.deepEqual(await interactiveRequestRegistry.resolve('request-1', {}), {
      status: 'invalid',
      error: 'bad answer',
    });
    assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 1);
  });

  test('interactive registry timeout invokes the provider adapter and clears replay state', async () => {
    let timedOut = false;
    let settled = '';
    interactiveRequestRegistry.register(baseRequest, {
      timeoutMs: 15,
      onResponse: () => {},
      onTimeout: () => {
        timedOut = true;
      },
      onSettled: (reason) => {
        settled = reason;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(timedOut, true);
    assert.equal(settled, 'timeout');
    assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 0);
  });

  test('Claude approval with a zero timeout remains pending for the human', async () => {
    let timedOut = false;
    interactiveRequestRegistry.register({
      ...baseRequest,
      provider: 'claude',
      toolName: 'Bash',
    }, {
      timeoutMs: 0,
      onResponse: () => {},
      onTimeout: () => {
        timedOut = true;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(timedOut, false);
    assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 1);
  });

  test('interactive registry server resolution and abort cancellation clear requests', async () => {
    let cancellations = 0;
    interactiveRequestRegistry.register(baseRequest, {
      onResponse: () => {},
      onCancel: () => {
        cancellations += 1;
      },
    });
    assert.equal(await interactiveRequestRegistry.markServerResolved('request-1'), true);
    assert.equal(cancellations, 0);

    interactiveRequestRegistry.register({ ...baseRequest, requestId: 'request-2' }, {
      onResponse: () => {},
      onCancel: () => {
        cancellations += 1;
      },
    });
    await interactiveRequestRegistry.cancelForSession('thread-1');
    assert.equal(cancellations, 1);
    assert.equal(interactiveRequestRegistry.getPendingForSession('thread-1').length, 0);
  });

  test('a pending request is reported only by the provider that owns it', () => {
    // The registry is one process-wide map shared by every runtime, and the
    // gateway's getPendingApprovalsForSession flat-maps over all of them. An
    // unfiltered per-session lookup therefore answered the same entry to each
    // runtime, so `chat.subscribe` replayed one prompt twice and the client
    // rendered two identical question panels on returning to the session.
    interactiveRequestRegistry.register({
      ...baseRequest,
      requestId: 'claude-request',
      provider: 'claude',
      sessionId: 'app-session-1',
      toolName: 'AskUserQuestion',
    }, { onResponse: () => {} });

    assert.deepEqual(
      interactiveRequestRegistry
        .getPendingForSession('app-session-1', 'claude')
        .map((request) => request.requestId),
      ['claude-request'],
    );

    // Codex shares the map but owns nothing in this session.
    assert.deepEqual(
      interactiveRequestRegistry.getPendingForSession('app-session-1', 'codex'),
      [],
    );

    // Unscoped callers still see everything for the session.
    assert.equal(
      interactiveRequestRegistry.getPendingForSession('app-session-1').length,
      1,
    );
  });

  test('providers sharing a session id each report only their own pending request', () => {
    interactiveRequestRegistry.register({
      ...baseRequest,
      requestId: 'claude-request',
      provider: 'claude',
      sessionId: 'shared-session',
    }, { onResponse: () => {} });
    interactiveRequestRegistry.register({
      ...baseRequest,
      requestId: 'codex-request',
      provider: 'codex',
      sessionId: 'shared-session',
    }, { onResponse: () => {} });

    assert.deepEqual(
      interactiveRequestRegistry
        .getPendingForSession('shared-session', 'claude')
        .map((request) => request.requestId),
      ['claude-request'],
    );
    assert.deepEqual(
      interactiveRequestRegistry
        .getPendingForSession('shared-session', 'codex')
        .map((request) => request.requestId),
      ['codex-request'],
    );
  });
});

describe('claude-runtime error results', () => {
  const notice = "You've hit your session limit \u00B7 resets 5:40pm (America/Edmonton)";
  const wrapped = new Error(`Claude Code returned an error result: ${notice}`);

  // Imported here, not at the top: the registry owns this module's
  // initialization order, and pulling it in first breaks the cycle open.
  const loadPredicate = async (): Promise<(streamed: boolean, error: unknown) => boolean> => (
    (await import('@/modules/providers/list/claude/claude-runtime.provider.js')).duplicatesStreamedNotice
  );

  test('the SDK rethrow of an already-streamed notice does not draw a second row', async () => {
    assert.equal((await loadPredicate())(true, wrapped), true);
  });

  test('an error result nothing announced still reaches the user', async () => {
    // Nothing was streamed, so suppressing here would end the turn in silence.
    assert.equal((await loadPredicate())(false, wrapped), false);
  });

  const loadTurnLog = async () => (
    (await import('@/modules/providers/list/claude/claude-runtime.provider.js')).formatTurnLog
  );

  test('a turn log line names the event and app session id', async () => {
    const line = (await loadTurnLog())('api-retry', 'app-session-1', {
      ms: 1200,
      attempt: '2/10',
      http: 529,
      error: 'overloaded',
    });
    assert.equal(line, '[turn] api-retry session=app-session-1 ms=1200 attempt=2/10 http=529 error=overloaded');
  });

  test('a turn log line drops empty fields and keeps a new session readable', async () => {
    assert.equal((await loadTurnLog())('end', null, { frames: 12, retries: 0, aborted: undefined }),
      '[turn] end session=new frames=12 retries=0');
  });

  test('a turn log line flattens and truncates provider text so one event stays one line', async () => {
    const line = (await loadTurnLog())('error-result', 's1', { detail: `${'x'.repeat(200)}\nsecond line` });
    assert.equal(line.includes('\n'), false);
    assert.equal(line.length, 160 + '[turn] error-result session=s1 detail='.length);
  });

  const loadAskSideQuestion = async () => (
    (await import('@/modules/providers/list/claude/claude-runtime.provider.js')).runSideQuestion
  );

  test('a side question keeps the answer and names a fallback model', async () => {
    const ask = await loadAskSideQuestion();
    const answer = await ask({
      async askSideQuestion(question: string) {
        assert.equal(question, 'what is the plan?');
        return {
          response: '  three phases  ',
          synthetic: false,
          refusalFallback: { originalModel: 'opus', fallbackModel: 'sonnet' },
        };
      },
    }, 'what is the plan?');

    assert.deepEqual(answer, {
      answer: 'three phases',
      synthetic: false,
      fallbackNotice: 'Answered by sonnet instead of opus.',
    });
  });

  test('an SDK without the side-question call degrades instead of failing the chat', async () => {
    const ask = await loadAskSideQuestion();
    await assert.rejects(
      () => ask({}, 'what is the plan?'),
      /Side questions are unavailable/,
    );
  });

  test('a genuine failure is never mistaken for the notice wrapper', async () => {
    const duplicates = await loadPredicate();
    assert.equal(duplicates(true, new Error('spawn ENOENT')), false);
    assert.equal(duplicates(true, undefined), false);
  });
});
