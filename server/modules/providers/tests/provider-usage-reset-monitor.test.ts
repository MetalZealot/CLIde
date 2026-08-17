import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderUsageResetMonitor } from '@/modules/providers/services/provider-usage-reset-monitor.service.js';
import type { LLMProvider, ProviderUsageStatus } from '@/shared/types.js';

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
  state?: { notified: string[] };
  usage?: ProviderUsageStatus;
};

function createHarness(options: HarnessOptions = {}) {
  let enabled = options.enabled ?? true;
  let state = options.state ?? { notified: [] };
  const timeouts = new Map<number, ScheduledTimeout>();
  const intervals = new Map<number, () => void>();
  const notifications: Array<{ provider: LLMProvider; labels: string[] }> = [];
  let nextTimer = 1;
  let now = options.now ?? Date.parse('2026-08-16T12:00:00.000Z');
  const usage = options.usage ?? {
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
    getUsage: async () => usage,
    isEnabled: (_userId, provider) => enabled && provider === 'claude',
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
    timeouts,
    /** The single pending timeout, asserting there is exactly one. */
    onlyTimeout: () => {
      assert.equal(timeouts.size, 1);
      return [...timeouts.values()][0]!;
    },
    getState: () => state,
    disable: () => { enabled = false; },
    advance: (ms: number) => { now += ms; },
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
