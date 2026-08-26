import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { getProviderSessionEffort, resolveSessionEffort } from '@/modules/providers/index.js';
import type { SessionEffortPickStore } from '@/modules/providers/index.js';
import { readClaudeSessionEffortFromJsonl } from '@/modules/providers/list/claude/claude-session-effort.js';
import { readCodexSessionEffortFromRollout } from '@/modules/providers/list/codex/codex-session-effort.js';
import { createProviderModelsService, PROVIDER_MODELS_CACHE_TTL_MS } from '@/modules/providers/services/provider-models.service.js';
import type { SessionModelPickStore } from '@/modules/providers/services/provider-session-model.service.js';
import type {
  LLMProvider,
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';

describe('provider-models.service', () => {
  const createModels = (value: string): ProviderModelsDefinition => ({
    OPTIONS: [{ value, label: value }],
    DEFAULT: value,
  });

  const createCurrentActiveModel = (
    model: string,
    source?: ProviderCurrentActiveModel['source'],
  ): ProviderCurrentActiveModel => ({
    model,
    ...(source ? { source } : {}),
  });

  const createSessionActiveModelChange = (
    provider: LLMProvider,
    input: ProviderChangeActiveModelInput,
  ): ProviderSessionActiveModelChange => ({
    provider,
    sessionId: input.sessionId,
    supported: true,
    changed: true,
    model: input.model,
  });

  const createEphemeralCachePath = (): string => path.join(
    os.tmpdir(),
    `provider-model-cache-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );

  test('provider models service delegates to the resolved provider model adapter', async () => {
    const calls: LLMProvider[] = [];
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => {
        calls.push(provider);
        return {
          models: {
            getSupportedModels: async () => createModels(`${provider}-models`),
            getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
            changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
          },
        };
      },
    });

    const models = await service.getProviderModels('codex', { bypassCache: true });

    assert.deepEqual(calls, ['codex']);
    assert.equal(models.models.DEFAULT, 'codex-models');
    assert.equal(models.cache.source, 'fresh');
  });

  test('provider models service returns each provider adapter result without rewriting it', async () => {
    const expectedModels: ProviderModelsDefinition = {
      OPTIONS: [
        { value: 'cursor-a', label: 'Cursor A' },
        { value: 'cursor-b', label: 'Cursor B' },
      ],
      DEFAULT: 'cursor-b',
    };

    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => expectedModels,
          getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
        },
      }),
    });

    const models = await service.getProviderModels('cursor', { bypassCache: true });

    assert.deepEqual(models.models, expectedModels);
  });

  test('provider models are cached for the three-day ttl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-ttl-'));
    let currentTime = 1_000;
    let loadCount = 0;

    try {
      const service = createProviderModelsService({
        cachePath: path.join(tempRoot, 'models-cache.json'),
        now: () => currentTime,
        resolveProvider: (provider) => ({
          models: {
            getSupportedModels: async () => {
              loadCount += 1;
              return createModels(`${provider}-${loadCount}`);
            },
            getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
            changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
          },
        }),
      });

      const first = await service.getProviderModels('cursor');
      const cached = await service.getProviderModels('cursor');
      assert.equal(loadCount, 1);
      assert.equal(cached.models.DEFAULT, first.models.DEFAULT);
      assert.equal(cached.cache.source, 'memory');

      currentTime += PROVIDER_MODELS_CACHE_TTL_MS - 1;
      await service.getProviderModels('cursor');
      assert.equal(loadCount, 1);

      currentTime += 2;
      const refreshed = await service.getProviderModels('cursor');
      assert.equal(loadCount, 2);
      assert.equal(refreshed.models.DEFAULT, 'cursor-2');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  for (const provider of ['claude', 'codex'] as const) {
    test(`${provider} provider models are always loaded directly from the provider`, async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), `provider-model-cache-${provider}-direct-`));
      let loadCount = 0;

      try {
        const service = createProviderModelsService({
          cachePath: path.join(tempRoot, 'models-cache.json'),
          resolveProvider: (resolvedProvider) => ({
            models: {
              getSupportedModels: async () => {
                loadCount += 1;
                return createModels(`${resolvedProvider}-${loadCount}`);
              },
              getCurrentActiveModel: async () => createCurrentActiveModel(`${resolvedProvider}-active`),
              changeActiveModel: async (input) => createSessionActiveModelChange(resolvedProvider, input),
            },
          }),
        });

        const first = await service.getProviderModels(provider);
        const second = await service.getProviderModels(provider);

        assert.equal(loadCount, 2);
        assert.equal(first.models.DEFAULT, `${provider}-1`);
        assert.equal(second.models.DEFAULT, `${provider}-2`);
        assert.equal(second.cache.source, 'fresh');
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });
  }

  test('provider model cache is persisted across service instances', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-file-'));
    const cachePath = path.join(tempRoot, 'models-cache.json');

    try {
      const writer = createProviderModelsService({
        cachePath,
        resolveProvider: () => ({
          models: {
            getSupportedModels: async () => createModels('cursor-cached'),
            getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
            changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
          },
        }),
      });
      await writer.getProviderModels('cursor');

      const reader = createProviderModelsService({
        cachePath,
        resolveProvider: () => ({
          models: {
            getSupportedModels: async () => {
              throw new Error('loader should not be called for persisted cache hits');
            },
            getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
            changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
          },
        }),
      });
      const models = await reader.getProviderModels('cursor');
      assert.equal(models.models.DEFAULT, 'cursor-cached');
      assert.equal(models.cache.source, 'disk');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('concurrent provider model requests share one load operation', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-pending-'));
    let loadCount = 0;

    try {
      const service = createProviderModelsService({
        cachePath: path.join(tempRoot, 'models-cache.json'),
        resolveProvider: () => ({
          models: {
            getSupportedModels: async () => {
              loadCount += 1;
              await new Promise((resolve) => setTimeout(resolve, 20));
              return createModels('claude-cached');
            },
            getCurrentActiveModel: async () => createCurrentActiveModel('claude-active'),
            changeActiveModel: async (input) => createSessionActiveModelChange('claude', input),
          },
        }),
      });

      const [first, second] = await Promise.all([
        service.getProviderModels('claude'),
        service.getProviderModels('claude'),
      ]);

      assert.equal(loadCount, 1);
      assert.equal(first.models.DEFAULT, 'claude-cached');
      assert.equal(second.models.DEFAULT, 'claude-cached');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('bypassCache forces a fresh provider fetch and updates cache metadata', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-refresh-'));
    let currentTime = 1_000;
    let loadCount = 0;

    try {
      const service = createProviderModelsService({
        cachePath: path.join(tempRoot, 'models-cache.json'),
        now: () => currentTime,
        resolveProvider: (provider) => ({
          models: {
            getSupportedModels: async () => {
              loadCount += 1;
              return createModels(`${provider}-${loadCount}`);
            },
            getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active-${loadCount}`),
            changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
          },
        }),
      });

      const first = await service.getProviderModels('claude');
      currentTime += 50;
      const refreshed = await service.getProviderModels('claude', { bypassCache: true });

      assert.equal(first.models.DEFAULT, 'claude-1');
      assert.equal(refreshed.models.DEFAULT, 'claude-2');
      assert.equal(refreshed.cache.source, 'fresh');
      assert.notEqual(refreshed.cache.updatedAt, first.cache.updatedAt);
      assert.equal(loadCount, 2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('provider models service delegates current active model lookups to the provider adapter', async () => {
    const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
    const service = createProviderModelsService({
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async (sessionId) => {
            calls.push({ provider, sessionId });
            return createCurrentActiveModel(`${provider}-${sessionId}`);
          },
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const activeModel = await service.getCurrentActiveModel('opencode', 'session-123');

    assert.deepEqual(calls, [{ provider: 'opencode', sessionId: 'session-123' }]);
    assert.equal(activeModel.model, 'opencode-session-123');
  });

  test('provider models service delegates active model change requests to the provider adapter', async () => {
    const calls: Array<{ provider: LLMProvider; input: ProviderChangeActiveModelInput }> = [];
    const service = createProviderModelsService({
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => {
            calls.push({ provider, input });
            return createSessionActiveModelChange(provider, input);
          },
        },
      }),
    });

    const changedModel = await service.changeActiveModel('claude', {
      sessionId: 'session-123',
      model: 'opus',
    });

    assert.deepEqual(calls, [{
      provider: 'claude',
      input: {
        sessionId: 'session-123',
        model: 'opus',
      },
    }]);
    assert.equal(changedModel.changed, true);
    assert.equal(changedModel.model, 'opus');
  });

  // Stands in for the sessions table. `updatedAt` defaults to now so a seeded
  // pick is "fresh" unless a test deliberately makes the transcript newer.
  const createPickStore = (
    seed?: { provider: string; sessionId: string; model: string; updatedAt?: string },
  ): SessionModelPickStore => ({
    getSessionModelPick: (sessionId, provider) =>
      (seed && seed.sessionId === sessionId && seed.provider === provider
        ? { model: seed.model, updatedAt: seed.updatedAt ?? new Date().toISOString() }
        : null),
    setSessionModelPick: () => true,
  });

  test('resolveResumeModel prefers a stored changed model over the requested one', async () => {
    const service = createProviderModelsService({
      modelPickStore: createPickStore({
        provider: 'cursor',
        sessionId: 'session-456',
        model: 'composer-2',
      }),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const model = await service.resolveResumeModel('cursor', 'session-456', 'composer-2-fast');
    assert.equal(model, 'composer-2');
  });

  test('resolveResumeModel ignores a pick that is older than the last transcript turn', async () => {
    const service = createProviderModelsService({
      modelPickStore: createPickStore({
        provider: 'claude',
        sessionId: 'session-789',
        model: 'opus',
      }),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`, 'default'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
          // A transcript turn recorded far in the future always supersedes the pick.
          getTranscriptTurnTimestamp: async () => new Date(Date.now() + 60_000).toISOString(),
        },
      }),
    });

    const model = await service.resolveResumeModel('claude', 'session-789', 'sonnet');
    assert.equal(model, 'sonnet');
  });

  test('resolveResumeModel returns the requested model when no pick is stored', async () => {
    const service = createProviderModelsService({
      modelPickStore: createPickStore(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel('transcript-model', 'transcript'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const model = await service.resolveResumeModel('claude', 'session-1', 'requested-model');
    assert.equal(model, 'requested-model');
  });

  test('resolveResumeModel falls back to the session transcript model when nothing is requested', async () => {
    const service = createProviderModelsService({
      modelPickStore: createPickStore(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel('transcript-model', 'transcript'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const model = await service.resolveResumeModel('claude', 'session-1', undefined);
    assert.equal(model, 'transcript-model');
  });

  test('resolveResumeModel never adopts a default-source model as the session model', async () => {
    const service = createProviderModelsService({
      modelPickStore: createPickStore(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          // Codex-style adapter: reports global config, not session state.
          getCurrentActiveModel: async () => createCurrentActiveModel('global-config-model', 'default'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const model = await service.resolveResumeModel('codex', 'session-1', undefined);
    assert.equal(model, undefined);
  });

  // `resolveSessionModel` coverage adapted from upstream 1.37. Upstream drove
  // these through a `sessions` store stub because its version reads the recorded
  // `sessions.model` column *first*. This fork now stores picks in that same
  // column but keeps them behind transcript evidence (ADR 0025), so these tests
  // exercise the provider/requested/default chain that decides display.
  test('resolveSessionModel asks the provider adapter for the session it was given', async () => {
    const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async (sessionId) => {
            calls.push({ provider, sessionId });
            return createCurrentActiveModel(`${provider}-${sessionId}`);
          },
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const resolved = await service.resolveSessionModel('opencode', { sessionId: 'session-123' });

    assert.deepEqual(calls, [{ provider: 'opencode', sessionId: 'session-123' }]);
    assert.equal(resolved.model, 'opencode-session-123');
  });

  test('resolveSessionModel prefers the provider\'s own session state over the requested model', async () => {
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const resolved = await service.resolveSessionModel('opencode', {
      sessionId: 'session-1',
      requestedModel: 'requested',
    });

    assert.equal(resolved.model, 'provider-reported');
    assert.equal(resolved.source, 'provider');
  });

  test('resolveSessionModel uses the requested model when the provider only reports its catalog default', async () => {
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels('default'),
          getCurrentActiveModel: async () => createCurrentActiveModel('default'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const resolved = await service.resolveSessionModel('claude', {
      sessionId: 'session-1',
      requestedModel: 'haiku',
    });

    assert.equal(resolved.model, 'haiku');
    assert.equal(resolved.source, 'session');
  });

  test('resolveSessionModel answers with the requested model for a chat that has no session yet', async () => {
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const resolved = await service.resolveSessionModel('codex', { requestedModel: 'gpt-5.5' });

    assert.equal(resolved.model, 'gpt-5.5');
    assert.equal(resolved.sessionId, null);
    assert.equal(resolved.source, 'session');
  });

  test('resolveSessionModel falls back to the catalog default with nothing else to go on', async () => {
    const service = createProviderModelsService({
      cachePath: createEphemeralCachePath(),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const resolved = await service.resolveSessionModel('codex');

    assert.equal(resolved.model, 'codex-models');
    assert.equal(resolved.source, 'default');
  });
});

describe('session-effort-resolution', () => {
  const EARLIER = '2026-08-17T10:00:00.000Z';
  const LATER = '2026-08-17T11:00:00.000Z';

  const resolveClaude = (
    pick: { effort: string | null; updatedAt?: string } | null,
    evidence: { effort: string; timestamp?: string } | null,
    providerDefault?: string | null,
  ) => resolveSessionEffort({
    provider: 'claude',
    sessionId: 'session-1',
    supported: true,
    pick,
    evidence,
    providerDefault,
  });

  test('a pick at least as recent as the last turn still describes the session', () => {
    const resolved = resolveClaude(
      { effort: 'medium', updatedAt: LATER },
      { effort: 'high', timestamp: EARLIER },
    );

    assert.equal(resolved.effort, 'medium');
    assert.equal(resolved.source, 'pick');
    // Both inputs stay visible: the request won, but the last turn really did run
    // at "high", and a caller that needs to say so can.
    assert.equal(resolved.requested, 'medium');
    assert.equal(resolved.effective, 'high');
  });

  test('a newer turn supersedes an older pick', () => {
    const resolved = resolveClaude(
      { effort: 'medium', updatedAt: EARLIER },
      { effort: 'high', timestamp: LATER },
    );

    // The effort changed by a path the app never saw — a Shell /model, fast mode
    // — and the transcript is the record of what actually ran (ADR 0003).
    assert.equal(resolved.effort, 'high');
    assert.equal(resolved.source, 'transcript');
  });

  test('an explicit default is a standing choice no turn can age out', () => {
    // Picking "default" means "let the provider choose each turn", so every turn
    // it produces stamps a concrete effort that disagrees with it. Superseding on
    // that would retire the choice after one turn.
    const resolved = resolveClaude(
      { effort: 'default', updatedAt: EARLIER },
      { effort: 'high', timestamp: LATER },
    );

    assert.equal(resolved.effort, 'default');
    assert.equal(resolved.source, 'pick');
    assert.equal(resolved.effective, 'high', 'what actually ran is still reported');
  });

  test('a newer concrete pick replaces a standing default', () => {
    const resolved = resolveClaude(
      { effort: 'low', updatedAt: LATER },
      { effort: 'high', timestamp: EARLIER },
    );

    assert.equal(resolved.effort, 'low');
    assert.equal(resolved.source, 'pick');
  });

  test('a pick that lost its timestamp defers to turn evidence', () => {
    const resolved = resolveClaude(
      { effort: 'medium' },
      { effort: 'high', timestamp: EARLIER },
    );

    assert.equal(resolved.effort, 'high');
    assert.equal(resolved.source, 'transcript');
  });

  test('a pick with no turn to argue against stands', () => {
    const resolved = resolveClaude({ effort: 'medium', updatedAt: EARLIER }, null);

    assert.equal(resolved.effort, 'medium');
    assert.equal(resolved.source, 'pick');
    assert.equal(resolved.effective, null);
  });

  test('turn evidence alone resolves the session', () => {
    const resolved = resolveClaude(null, { effort: 'xhigh', timestamp: LATER });

    assert.equal(resolved.effort, 'xhigh');
    assert.equal(resolved.source, 'transcript');
    assert.equal(resolved.requested, null);
  });

  test('with nothing chosen and nothing recorded the provider default applies', () => {
    const resolved = resolveClaude(null, null, 'medium');

    assert.equal(resolved.effort, 'medium');
    assert.equal(resolved.source, 'default');
  });

  test('an unknown default resolves to no effort rather than a guess', () => {
    const resolved = resolveClaude(null, null);

    assert.equal(resolved.effort, null);
    assert.equal(resolved.source, 'none');
  });

  test('an unsupported provider resolves to nothing at all', () => {
    const resolved = resolveSessionEffort({
      provider: 'cursor',
      sessionId: 'session-1',
      supported: false,
      pick: { effort: 'high', updatedAt: LATER },
      evidence: { effort: 'high', timestamp: LATER },
      providerDefault: 'medium',
    });

    assert.equal(resolved.supported, false);
    assert.equal(resolved.effort, null);
    assert.equal(resolved.requested, null);
    assert.equal(resolved.effective, null);
    assert.equal(resolved.source, 'none');
  });

  const stubStore = (pick: { effort: string; updatedAt: string | null } | null): SessionEffortPickStore => ({
    getSessionEffortPick: () => pick,
    setSessionEffortPick: () => true,
  });

  test('an adapter with no turn evidence reports the request without inventing effective state', async () => {
    // OpenCode accepts effort but records nothing about what a turn ran at.
    // Echoing the request back as `effective` would be a fabricated confirmation
    // that then outranks real evidence anywhere the two are compared.
    const resolved = await getProviderSessionEffort('opencode', 'session-1', {
      store: stubStore({ effort: 'high', updatedAt: EARLIER }),
      getSessionRow: () => ({ jsonl_path: '/does/not/matter.jsonl' }),
    });

    assert.equal(resolved.supported, true);
    assert.equal(resolved.requested, 'high');
    assert.equal(resolved.effective, null);
    assert.equal(resolved.effort, 'high');
    assert.equal(resolved.source, 'pick');
  });

  test('an adapter with no turn evidence and no pick falls back to the provider default', async () => {
    const resolved = await getProviderSessionEffort('opencode', 'session-1', {
      store: stubStore(null),
      providerDefault: 'medium',
    });

    assert.equal(resolved.effective, null);
    assert.equal(resolved.effort, 'medium');
    assert.equal(resolved.source, 'default');
  });

  test('an unsupported provider short-circuits before reading anything', async () => {
    let storeWasRead = false;
    const resolved = await getProviderSessionEffort('cursor', 'session-1', {
      store: {
        getSessionEffortPick: () => {
          storeWasRead = true;
          return { effort: 'high', updatedAt: EARLIER };
        },
        setSessionEffortPick: () => true,
      },
    });

    assert.equal(resolved.supported, false);
    assert.equal(resolved.effort, null);
    assert.equal(storeWasRead, false, 'an unsupported provider should not read storage');
  });

  async function withTranscript(
    name: string,
    lines: unknown[],
    runTest: (transcriptPath: string) => Promise<void>,
  ): Promise<void> {
    const directory = await mkdtemp(path.join(tmpdir(), 'session-effort-transcript-'));
    const transcriptPath = path.join(directory, name);
    await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    try {
      await runTest(transcriptPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  test("Claude's transcript reports the effort of the last real turn", async () => {
    await withTranscript('claude.jsonl', [
      { type: 'assistant', sessionId: 'provider-1', effort: 'low', timestamp: EARLIER },
      { type: 'assistant', sessionId: 'provider-1', effort: 'high', timestamp: LATER },
      // A subagent turn runs at its own effort and says nothing about the
      // conversation the user is looking at.
      { type: 'assistant', sessionId: 'provider-1', effort: 'max', isSidechain: true, timestamp: LATER },
      // A superseded provider session's entries can survive a rewind in the same
      // file; they belong to a different conversation.
      { type: 'assistant', sessionId: 'provider-old', effort: 'medium', timestamp: LATER },
      { type: 'assistant', sessionId: 'provider-1', timestamp: LATER },
    ], async (transcriptPath) => {
      const evidence = await readClaudeSessionEffortFromJsonl('provider-1', transcriptPath);
      assert.deepEqual(evidence, { effort: 'high', timestamp: LATER });
    });
  });

  test('a Claude transcript with no effort stamped reports none', async () => {
    await withTranscript('claude-bare.jsonl', [
      { type: 'assistant', sessionId: 'provider-1', timestamp: EARLIER },
      'not json at all',
    ], async (transcriptPath) => {
      assert.equal(await readClaudeSessionEffortFromJsonl('provider-1', transcriptPath), null);
    });
  });

  test("Codex's rollout reports the effort of the newest turn_context", async () => {
    await withTranscript('rollout.jsonl', [
      { type: 'turn_context', timestamp: EARLIER, payload: { turn_id: 'a', effort: 'low' } },
      { type: 'turn_context', timestamp: LATER, payload: { turn_id: 'b', effort: 'high' } },
      { type: 'event_msg', timestamp: LATER, payload: { type: 'token_count' } },
    ], async (transcriptPath) => {
      const evidence = await readCodexSessionEffortFromRollout(transcriptPath);
      assert.deepEqual(evidence, { effort: 'high', timestamp: LATER });
    });
  });

  test("Codex's collaboration-mode settings are read when the top-level effort is absent", async () => {
    await withTranscript('rollout-legacy.jsonl', [
      {
        type: 'turn_context',
        timestamp: LATER,
        payload: {
          turn_id: 'a',
          collaboration_mode: { mode: 'default', settings: { reasoning_effort: 'xhigh' } },
        },
      },
    ], async (transcriptPath) => {
      const evidence = await readCodexSessionEffortFromRollout(transcriptPath);
      assert.deepEqual(evidence, { effort: 'xhigh', timestamp: LATER });
    });
  });

  test('a session resolves against its own transcript, keyed by the provider-native id', async () => {
    await withTranscript('claude-live.jsonl', [
      { type: 'assistant', sessionId: 'provider-1', effort: 'high', timestamp: LATER },
    ], async (transcriptPath) => {
      const superseded = await getProviderSessionEffort('claude', 'app-1', {
        store: stubStore({ effort: 'medium', updatedAt: EARLIER }),
        getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: transcriptPath }),
      });
      assert.equal(superseded.effort, 'high');
      assert.equal(superseded.source, 'transcript');

      const picked = await getProviderSessionEffort('claude', 'app-1', {
        store: stubStore({ effort: 'medium', updatedAt: LATER }),
        getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: transcriptPath }),
      });
      assert.equal(picked.effort, 'medium');
      assert.equal(picked.source, 'pick');
    });
  });

  test('an unreadable transcript degrades to the stored request instead of failing', async () => {
    const resolved = await getProviderSessionEffort('claude', 'app-1', {
      store: stubStore({ effort: 'medium', updatedAt: EARLIER }),
      getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: '/nonexistent/transcript.jsonl' }),
    });

    assert.equal(resolved.effective, null);
    assert.equal(resolved.effort, 'medium');
    assert.equal(resolved.source, 'pick');
  });
});
