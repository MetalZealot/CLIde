import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import Database from 'better-sqlite3';

import type { ClaudeContextCeiling } from '@/modules/providers/list/claude/claude-context-usage.js';
import { normalizeClaudeRateLimitEvent } from '@/modules/providers/list/claude/claude-usage.provider.js';
import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { createProviderUsageResetMonitor } from '@/modules/providers/services/provider-usage-reset-monitor.service.js';
import { createProviderUsageService } from '@/modules/providers/services/provider-usage.service.js';
import type { LLMProvider, ProviderSessionActiveModelChange, ProviderUsageStatus } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

describe('provider-usage.service', () => {
  test('failed refresh preserves the last successful timestamp and becomes retryable after the safety floor', async () => {
    let now = Date.parse('2026-08-16T12:00:00.000Z');
    let calls = 0;
    const successful: ProviderUsageStatus = {
      provider: 'claude',
      supported: true,
      windows: [{ id: 'five_hour', utilization: 20, resetsAt: '2026-08-16T13:00:00.000Z' }],
      fetchedAt: '2026-08-16T12:00:00.000Z',
    };
    const service = createProviderUsageService({
      now: () => now,
      resolveUsage: () => ({
        getUsage: async () => {
          calls += 1;
          return calls === 1
            ? successful
            : { provider: 'claude', supported: true, error: 'temporarily unavailable' };
        },
      }),
    });

    assert.deepEqual(await service.getProviderUsage('claude'), successful);
    now += 60_001;
    const stale = await service.getProviderUsage('claude');
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, successful.fetchedAt);

    now += 15_001;
    await service.getProviderUsage('claude');
    assert.equal(calls, 3);
  });

  test('Claude live rate-limit events normalize epoch seconds into shared windows', () => {
    assert.deepEqual(normalizeClaudeRateLimitEvent({
      rateLimitType: 'seven_day_sonnet',
      utilization: 67.5,
      resetsAt: 1_776_000_000,
    }), {
      id: 'seven_day_sonnet',
      utilization: 67.5,
      resetsAt: new Date(1_776_000_000_000).toISOString(),
    });
  });

  test('redemption forwards one logical attempt and refreshes past both cache timers', async () => {
    let usageReads = 0;
    const redemptionInputs: Array<{ idempotencyKey: string; creditId?: string }> = [];
    const service = createProviderUsageService({
      now: () => Date.parse('2026-09-13T12:00:00.000Z'),
      resolveUsage: () => ({
        getUsage: async () => {
          usageReads += 1;
          return {
            provider: 'codex',
            supported: true,
            windows: [{ id: 'seven_day', utilization: usageReads === 1 ? 90 : 0, resetsAt: null }],
            resetCredits: { availableCount: usageReads === 1 ? 3 : 2 },
          };
        },
        redeemResetCredit: async (input) => {
          redemptionInputs.push(input);
          return 'reset';
        },
      }),
    });

    await service.getProviderUsage('codex');
    const result = await service.redeemProviderUsageReset('codex', {
      idempotencyKey: 'attempt-1',
      creditId: 'credit-1',
    });

    assert.deepEqual(redemptionInputs, [{ idempotencyKey: 'attempt-1', creditId: 'credit-1' }]);
    assert.equal(usageReads, 2);
    assert.equal(result.outcome, 'reset');
    assert.equal(result.usage.windows?.[0].utilization, 0);
    assert.equal(result.usage.resetCredits?.availableCount, 2);
  });

  test('redemption is rejected when the provider exposes read-only usage', async () => {
    const service = createProviderUsageService({
      resolveUsage: () => ({
        getUsage: async () => ({ provider: 'claude', supported: true }),
      }),
    });

    await assert.rejects(
      service.redeemProviderUsageReset('claude', { idempotencyKey: 'attempt-1' }),
      (error: unknown) => (
        error instanceof AppError
        && error.code === 'USAGE_RESET_REDEMPTION_UNSUPPORTED'
        && error.statusCode === 409
      ),
    );
  });
});

describe('provider-usage-reset-monitor', () => {
  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  type ScheduledTimeout = {
    fire: () => void;
    delayMs: number;
  };

  type HarnessOptions = {
    now?: number;
    enabled?: boolean;
    pendingAutoContinue?: boolean;
    state?: { notified: string[]; exhausted?: Record<string, boolean> };
    usage?: ProviderUsageStatus;
  };

  function createHarness(options: HarnessOptions = {}) {
    let enabled = options.enabled ?? true;
    const pendingAutoContinue = options.pendingAutoContinue ?? false;
    const autoContinued: LLMProvider[] = [];
    let state = options.state ?? { notified: [] };
    const timeouts = new Map<number, ScheduledTimeout>();
    const intervals = new Map<number, () => void>();
    const notifications: Array<{ provider: LLMProvider; labels: string[] }> = [];
    let nextTimer = 1;
    let now = options.now ?? Date.parse('2026-08-16T12:00:00.000Z');
    let usageCalls = 0;
    let usage: ProviderUsageStatus = options.usage ?? {
      provider: 'claude',
      supported: true,
      windows: [{
        id: 'five_hour',
        utilization: 90,
        resetsAt: '2026-08-16T13:00:05.000Z',
      }, {
        id: 'seven_day',
        utilization: 45,
        resetsAt: '2026-08-16T13:00:40.000Z',
      }],
    };

    const monitor = createProviderUsageResetMonitor({
      listMonitoredProviders: () => ['claude', 'codex'],
      getUsage: async () => {
        usageCalls += 1;
        return usage;
      },
      isEnabled: (_userId, provider) => enabled && provider === 'claude',
      hasPendingAutoContinue: (provider) => pendingAutoContinue && provider === 'claude',
      fireAutoContinue: async (provider) => { autoContinued.push(provider); },
      readState: () => state,
      writeState: (_userId, nextState) => { state = nextState; },
      notify: (_userId, provider, reset) => notifications.push({
        provider,
        labels: reset.windowLabels,
      }),
      setInterval: (callback) => {
        const id = nextTimer++;
        intervals.set(id, callback);
        return id as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (timer) => intervals.delete(timer as unknown as number),
      setTimeout: (callback, delayMs) => {
        const id = nextTimer++;
        // A real timeout is gone once it fires; drop it here too, so a callback
        // that re-arms under the same identity leaves exactly one pending timer.
        timeouts.set(id, {
          fire: () => {
            timeouts.delete(id);
            callback();
          },
          delayMs,
        });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (timer) => timeouts.delete(timer as unknown as number),
      now: () => now,
    });

    return {
      monitor,
      notifications,
      autoContinued,
      timeouts,
      /** The single pending timeout, asserting there is exactly one. */
      onlyTimeout: () => {
        assert.equal(timeouts.size, 1);
        return [...timeouts.values()][0]!;
      },
      getState: () => state,
      disable: () => { enabled = false; },
      advance: (ms: number) => { now += ms; },
      /** Drives the five-minute poll every monitor is armed with. */
      poll: async () => {
        for (const callback of [...intervals.values()]) callback();
        await flushPromises();
      },
      setUsage: (next: ProviderUsageStatus) => { usage = next; },
      getUsageCalls: () => usageCalls,
    };
  }

  test('coalesces same-provider resets in one minute and records delivery', async () => {
    const harness = createHarness();
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.onlyTimeout().fire();
    await flushPromises();

    assert.deepEqual(harness.notifications, [{
      provider: 'claude',
      labels: ['5-hour limit', 'Weekly limit'],
    }]);
    assert.equal(harness.getState().notified.length, 1);
  });

  test('does not schedule a reset whose provider timestamp is already past', async () => {
    const harness = createHarness({
      usage: {
        provider: 'claude',
        supported: true,
        windows: [{
          id: 'five_hour',
          utilization: 0,
          resetsAt: '2026-08-16T11:59:00.000Z',
        }],
      },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    assert.equal(harness.timeouts.size, 0);
    assert.equal(harness.notifications.length, 0);
  });

  test('does not reschedule an identity persisted as notified before restart', async () => {
    const minute = Math.floor(Date.parse('2026-08-16T13:00:05.000Z') / 60_000);
    const harness = createHarness({
      state: { notified: [`claude:${minute}:five_hour+seven_day`] },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    assert.equal(harness.timeouts.size, 0);
  });

  test('clears exact reset timers when the provider preference is disabled', async () => {
    const harness = createHarness();
    harness.monitor.reconcileUser(7);
    await flushPromises();
    assert.equal(harness.timeouts.size, 1);

    harness.disable();
    harness.monitor.reconcileUser(7);
    assert.equal(harness.timeouts.size, 0);
  });

  test('retries the post-reset refresh until one comes back with fresh data', async () => {
    const harness = createHarness({
      usage: {
        provider: 'claude',
        supported: true,
        windows: [{ id: 'five_hour', utilization: 90, resetsAt: '2026-08-16T13:00:05.000Z' }],
      },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.advance(60 * 60_000 + 5_000);
    harness.onlyTimeout().fire();
    await flushPromises();
    assert.equal(harness.notifications.length, 1);

    // The refresh is scheduled, not immediate: an immediate one lands inside the
    // usage cache's 15-second floor on upstream calls and reads back the very
    // snapshot the reset invalidated.
    const firstAttempt = harness.onlyTimeout();
    assert.equal(firstAttempt.delayMs, 20_000);

    const callsBeforeRefresh = harness.getUsageCalls();
    harness.setUsage({
      provider: 'claude',
      supported: true,
      stale: true,
      error: 'Claude\'s access token expired while idle. Send a message to refresh it.',
      windows: [{ id: 'five_hour', utilization: 90, resetsAt: '2026-08-16T13:00:05.000Z' }],
    });
    firstAttempt.fire();
    await flushPromises();
    assert.equal(harness.getUsageCalls(), callsBeforeRefresh + 1);

    // Still the pre-reset numbers, so it backs off and tries again.
    const secondAttempt = harness.onlyTimeout();
    assert.equal(secondAttempt.delayMs, 60_000);

    harness.setUsage({
      provider: 'claude',
      supported: true,
      windows: [{ id: 'five_hour', utilization: 0, resetsAt: null }],
    });
    secondAttempt.fire();
    await flushPromises();

    assert.equal(harness.timeouts.size, 0);
    assert.equal(harness.notifications.length, 1);
  });

  test('drops pending post-reset refreshes when the provider preference is disabled', async () => {
    const harness = createHarness({
      usage: {
        provider: 'claude',
        supported: true,
        windows: [{ id: 'five_hour', utilization: 90, resetsAt: '2026-08-16T13:00:05.000Z' }],
      },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.advance(60 * 60_000 + 5_000);
    harness.onlyTimeout().fire();
    await flushPromises();
    assert.equal(harness.timeouts.size, 1);

    harness.disable();
    harness.monitor.reconcileUser(7);
    assert.equal(harness.timeouts.size, 0);
  });

  test('re-arms rather than firing early for a reset past the setTimeout ceiling', async () => {
    const MAX_TIMER_DELAY_MS = 2_147_483_647;
    const harness = createHarness({
      // A monthly credit limit: ~30 days out, well past setTimeout's ~24.8-day
      // ceiling, where a raw delay fires on the next tick instead of waiting.
      usage: {
        provider: 'claude',
        supported: true,
        windows: [{
          id: 'individual_credit_limit',
          utilization: 10,
          resetsAt: '2026-09-15T12:00:00.000Z',
        }],
      },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    const staged = harness.onlyTimeout();
    assert.equal(staged.delayMs, MAX_TIMER_DELAY_MS);

    // The staged wake-up re-arms for the remainder; only then does it deliver.
    harness.advance(MAX_TIMER_DELAY_MS);
    staged.fire();
    assert.equal(harness.notifications.length, 0);

    const remainder = harness.onlyTimeout();
    assert.equal(
      remainder.delayMs,
      Date.parse('2026-09-15T12:00:00.000Z') - Date.parse('2026-08-16T12:00:00.000Z') - MAX_TIMER_DELAY_MS,
    );
    remainder.fire();
    await flushPromises();

    assert.equal(harness.notifications.length, 1);
  });

  test('fires Auto-Continue with reset alerts off, and keeps the monitor alive for it', async () => {
    const harness = createHarness({ enabled: false, pendingAutoContinue: true });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    // The alert preference alone would have stopped this provider outright.
    const resetTimer = harness.onlyTimeout();
    resetTimer.fire();
    await flushPromises();

    assert.deepEqual(harness.autoContinued, ['claude']);
    assert.equal(harness.notifications.length, 0);
    // Nothing is written to the alert dedupe list, so a later alert for the
    // same reset is still deliverable.
    assert.deepEqual(harness.getState().notified, []);
    // The panel is refreshed for whoever looks, alert or not.
    assert.equal(harness.onlyTimeout().delayMs, 20_000);
  });

  test('an alert and Auto-Continue for one reset do not suppress each other', async () => {
    const harness = createHarness({ pendingAutoContinue: true });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.onlyTimeout().fire();
    await flushPromises();

    assert.deepEqual(harness.autoContinued, ['claude']);
    assert.equal(harness.notifications.length, 1);
    assert.equal(harness.getState().notified.length, 1);
  });

  test('leaves Auto-Continue alone on a provider nothing is waiting on', async () => {
    const harness = createHarness();
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.onlyTimeout().fire();
    await flushPromises();

    assert.deepEqual(harness.autoContinued, []);
    assert.equal(harness.notifications.length, 1);
  });

  const claudeUsage = (utilization: number, resetsAt: string): ProviderUsageStatus => ({
    provider: 'claude',
    supported: true,
    windows: [{ id: 'five_hour', utilization, resetsAt }],
  });

  const spent = claudeUsage(100, '2026-08-16T13:00:05.000Z');
  /** An early reset looks like this: nothing left to use, and a later boundary. */
  const recovered = claudeUsage(0, '2026-08-16T18:00:05.000Z');

  test('an early reset fires Auto-Continue on the poll that sees usage recover', async () => {
    const harness = createHarness({ pendingAutoContinue: true, usage: spent });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.setUsage(recovered);
    await harness.poll();

    // The timer it was waiting on was cancelled, not fired: its identity left
    // the poll with the old `resetsAt`.
    assert.deepEqual(harness.autoContinued, ['claude']);
  });

  test('a poll that is stale or errored is not read as recovery', async () => {
    const harness = createHarness({ pendingAutoContinue: true, usage: spent });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    harness.setUsage({ ...recovered, stale: true });
    await harness.poll();
    assert.deepEqual(harness.autoContinued, []);

    harness.setUsage({ ...recovered, error: 'upstream refused' });
    await harness.poll();
    assert.deepEqual(harness.autoContinued, []);

    harness.setUsage(recovered);
    await harness.poll();
    assert.deepEqual(harness.autoContinued, ['claude']);
  });

  test('usage that was never spent does not release a message waiting on the reset', async () => {
    const harness = createHarness({ pendingAutoContinue: true, usage: recovered });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    await harness.poll();

    // "When usage resets" scheduled on a healthy provider still means the next
    // boundary, which is the armed timer's job.
    assert.deepEqual(harness.autoContinued, []);
  });

  test('recording an alert keeps the spent flag a later recovery depends on', async () => {
    const harness = createHarness({ pendingAutoContinue: true, usage: spent });
    harness.monitor.reconcileUser(7);
    await flushPromises();
    assert.equal(harness.getState().exhausted?.claude, true);

    harness.onlyTimeout().fire();
    await flushPromises();

    assert.equal(harness.getState().notified.length, 1);
    assert.equal(harness.getState().exhausted?.claude, true);
  });

  test('a restart spanning the reset still sees the recovery', async () => {
    const harness = createHarness({
      pendingAutoContinue: true,
      usage: recovered,
      state: { notified: [], exhausted: { claude: true } },
    });
    harness.monitor.reconcileUser(7);
    await flushPromises();

    assert.deepEqual(harness.autoContinued, ['claude']);
    assert.equal(harness.getState().exhausted?.claude, false);
  });
});

describe('provider-token-usage.service', () => {
  function createSessionRow(overrides: Record<string, unknown> = {}) {
    return {
      session_id: 'app-session',
      provider: 'claude',
      provider_session_id: 'provider-session',
      project_path: null,
      jsonl_path: null,
      custom_name: null,
      isArchived: 0,
      isStarred: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  /** Stands in for "the user has never picked a model for this session". */
  const unchangedActiveModel = async (
    sessionId: string,
  ): Promise<ProviderSessionActiveModelChange> => ({
    provider: 'claude',
    sessionId,
    supported: true,
    changed: false,
    model: null,
  });

  const sdkContextCeiling = async (): Promise<ClaudeContextCeiling> => ({
    maxTokens: 222_222,
    isAutoCompactEnabled: false,
    model: 'claude-sonnet-4-5-20250929',
    fetchedAt: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  test('token usage lookup requires only the app-facing session id for Claude', async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-claude-'));
    const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');

    try {
      await writeFile(sessionFilePath, [
        JSON.stringify({
          type: 'assistant',
          message: {
            usage: {
              input_tokens: 100,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 5,
              output_tokens: 30,
            },
          },
        }),
        '{incomplete',
      ].join('\n'));

      const service = createProviderTokenUsageService({
        getSessionById: () => createSessionRow({ jsonl_path: sessionFilePath }),
        readClaudeContextWindowOverride: () => 180_000,
        loadClaudeContextCeiling: async () => null,
        // Pinned, so the assertion does not depend on the host's settings.json.
        readClaudeCeilingProvenance: () => ({ source: 'auto' }),
        getChangedActiveModel: unchangedActiveModel,
      });

      assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
        used: 155,
        total: 180_000,
        inputTokens: 125,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheCreationTokens: 5,
        cacheTokens: 25,
        autoCompactThreshold: undefined,
        isAutoCompactEnabled: undefined,
        ceilingSource: 'auto',
        ceilingCap: undefined,
        modelContextWindow: undefined,
        breakdown: { input: 125, output: 30 },
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test('Codex token usage uses the latest token_count snapshot', async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-codex-'));
    const sessionFilePath = path.join(tempDirectory, 'rollout-provider-session.jsonl');

    try {
      await writeFile(sessionFilePath, [
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
              model_context_window: 100_000,
            },
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 40, output_tokens: 9, total_tokens: 49 },
              model_context_window: 250_000,
            },
          },
        }),
      ].join('\n'));

      const service = createProviderTokenUsageService({
        getSessionById: () => createSessionRow({
          provider: 'codex',
          jsonl_path: sessionFilePath,
        }),
      });

      assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
        used: 49,
        total: 250_000,
        inputTokens: 40,
        outputTokens: 9,
        breakdown: { input: 40, output: 9 },
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test('OpenCode token usage resolves its provider-native id from the session row', async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-opencode-'));
    const databasePath = path.join(tempDirectory, 'opencode.db');
    const database = new Database(databasePath);

    try {
      database.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          tokens_input INTEGER,
          tokens_output INTEGER,
          tokens_reasoning INTEGER,
          tokens_cache_read INTEGER,
          tokens_cache_write INTEGER
        )
      `);
      database.prepare(`
        INSERT INTO session (
          id,
          tokens_input,
          tokens_output,
          tokens_reasoning,
          tokens_cache_read,
          tokens_cache_write
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run('provider-session', 12, 7, 3, 5, 2);
    } finally {
      database.close();
    }

    try {
      const service = createProviderTokenUsageService({
        getSessionById: () => createSessionRow({ provider: 'opencode' }),
        getOpenCodeDatabasePath: () => databasePath,
      });

      assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
        used: 29,
        inputTokens: 17,
        outputTokens: 7,
        breakdown: { input: 17, output: 7 },
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test('Cursor returns an explicit unsupported token usage result', async () => {
    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({ provider: 'cursor' }),
    });

    const result = await service.getSessionTokenUsage('app-session');

    assert.equal(result.unsupported, true);
    assert.equal(result.used, 0);
    assert.equal(result.total, 0);
  });

  test('token usage reports SESSION_NOT_FOUND for an unknown app session id', async () => {
    const service = createProviderTokenUsageService({ getSessionById: () => null });

    await assert.rejects(
      () => service.getSessionTokenUsage('missing-session'),
      (error: unknown) => (
        error instanceof AppError
        && error.code === 'SESSION_NOT_FOUND'
        && error.statusCode === 404
      ),
    );
  });

  test('the Claude ceiling prefers the SDK reading over the model table, and CONTEXT_WINDOW over both', async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-ceiling-'));
    const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');

    try {
      await writeFile(sessionFilePath, `${JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      })}\n`);

      const baseDependencies = {
        getSessionById: () => createSessionRow({ jsonl_path: sessionFilePath }),
        getChangedActiveModel: unchangedActiveModel,
        resolveClaudeDerivedCeiling: () => ({
          contextWindow: 111_111,
          autoCompactThreshold: 78_111,
          isAutoCompactEnabled: true,
        }),
      };

      // No override: the SDK's own cached reading for this session wins.
      const sdkService = createProviderTokenUsageService({
        ...baseDependencies,
        readClaudeContextWindowOverride: () => undefined,
        loadClaudeContextCeiling: sdkContextCeiling,
      });
      assert.equal((await sdkService.getSessionTokenUsage('app-session')).total, 222_222);

      // No SDK reading either: fall back to the model table, never a flat constant.
      const tableService = createProviderTokenUsageService({
        ...baseDependencies,
        readClaudeContextWindowOverride: () => undefined,
        loadClaudeContextCeiling: async () => null,
      });
      const tableUsage = await tableService.getSessionTokenUsage('app-session');
      assert.equal(tableUsage.total, 111_111);
      // The threshold comes with it: reporting the window alone puts the limit
      // 33,000 tokens later than the one that fires, until the next turn streams.
      assert.equal(tableUsage.autoCompactThreshold, 78_111);
      assert.equal(tableUsage.isAutoCompactEnabled, true);

      // CONTEXT_WINDOW outranks everything.
      const overrideService = createProviderTokenUsageService({
        ...baseDependencies,
        readClaudeContextWindowOverride: () => 333_333,
        loadClaudeContextCeiling: sdkContextCeiling,
      });
      assert.equal((await overrideService.getSessionTokenUsage('app-session')).total, 333_333);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
