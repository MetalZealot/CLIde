import { appConfigDb, notificationPreferencesDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerUsageService } from '@/modules/providers/services/provider-usage.service.js';
import type { LLMProvider, ProviderUsageStatus, ProviderUsageWindow } from '@/shared/types.js';

/**
 * Reset identities already delivered, so a restart cannot re-notify one.
 *
 * Only delivered identities are persisted. An "observed but not yet fired"
 * list was tried and removed: nothing ever read it back, because a fresh
 * usage fetch re-derives every pending reset on startup anyway.
 */
type ResetState = {
  notified: string[];
};

type ScheduledReset = {
  identity: string;
  resetsAtMs: number;
  windowLabels: string[];
};

type ProviderMonitor = {
  pollTimer: ReturnType<typeof setInterval>;
  resetTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Outstanding post-reset re-fetches; not keyed, they only need cancelling. */
  postResetTimers: Set<ReturnType<typeof setTimeout>>;
};

type ResetMonitorDependencies = {
  /** Providers whose capability entry declares `supportsUsageResetAlerts`. */
  listMonitoredProviders(): LLMProvider[];
  getUsage(provider: LLMProvider): Promise<ProviderUsageStatus>;
  isEnabled(userId: number, provider: LLMProvider): boolean;
  readState(userId: number): ResetState;
  writeState(userId: number, state: ResetState): void;
  notify(userId: number, provider: LLMProvider, reset: ScheduledReset): void;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  now(): number;
};

const POLL_INTERVAL_MS = 5 * 60_000;
const MAX_PERSISTED_IDENTITIES = 256;
/**
 * `setTimeout`'s 32-bit ceiling (~24.8 days). A larger delay does not wait —
 * it fires on the next tick, which for a monthly credit limit would deliver a
 * reset alert weeks early *and* record it as notified, silencing the real one.
 * Anything beyond the ceiling is re-armed in stages instead.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
/**
 * Delays for the re-fetch that follows a reset, which is the one fetch a user
 * actually reads — they open the dashboard *because* the alert fired.
 *
 * It is retried because the first attempt is the likeliest to come back empty:
 * the usage cache refuses any upstream call within 15s of the previous one, so
 * a poll shortly before the boundary silently turns the immediate re-fetch into
 * a cache read, and a provider token that expired while idle fails every
 * attempt until something renews it. Without retries the panel kept showing
 * pre-reset numbers until the next five-minute poll.
 */
const POST_RESET_REFRESH_DELAYS_MS = [20_000, 60_000, 180_000];

const labelWindow = (window: ProviderUsageWindow): string => {
  if (window.label) return window.label;
  if (window.id === 'five_hour' || window.durationMinutes === 300) return '5-hour limit';
  if (window.id === 'seven_day' || window.durationMinutes === 10_080) return 'Weekly limit';
  return window.id.replace(/[:_]/g, ' ').replace(/^\w/, (character) => character.toUpperCase());
};

const collectScheduledResets = (
  provider: LLMProvider,
  usage: ProviderUsageStatus,
  nowMs: number,
): ScheduledReset[] => {
  const windows = [...(usage.windows ?? [])];
  if (usage.credits?.kind === 'balance' && usage.credits.individualLimit?.resetsAt) {
    windows.push({
      id: 'individual_credit_limit',
      label: 'Individual credit limit',
      utilization: 100 - usage.credits.individualLimit.remainingPercent,
      resetsAt: usage.credits.individualLimit.resetsAt,
    });
  }

  const grouped = new Map<number, ProviderUsageWindow[]>();
  for (const window of windows) {
    const resetsAtMs = Date.parse(window.resetsAt ?? '');
    if (!Number.isFinite(resetsAtMs) || resetsAtMs <= nowMs) continue;
    const minute = Math.floor(resetsAtMs / 60_000);
    grouped.set(minute, [...(grouped.get(minute) ?? []), window]);
  }

  return [...grouped.entries()].map(([minute, group]) => {
    const windowIds = group.map((window) => window.id).sort();
    return {
      identity: `${provider}:${minute}:${windowIds.join('+')}`,
      resetsAtMs: Math.min(...group.map((window) => Date.parse(window.resetsAt ?? ''))),
      windowLabels: group.map(labelWindow),
    };
  });
};

/**
 * Creates the reset scheduler used by the provider module singleton and its
 * focused tests. Provider timestamps are authoritative; past resets are never
 * replayed when the process starts or resumes monitoring.
 */
export function createProviderUsageResetMonitor(dependencies: ResetMonitorDependencies) {
  const monitors = new Map<string, ProviderMonitor>();
  const monitorKey = (userId: number, provider: LLMProvider) => `${userId}:${provider}`;

  const stopProvider = (userId: number, provider: LLMProvider) => {
    const key = monitorKey(userId, provider);
    const monitor = monitors.get(key);
    if (!monitor) return;
    dependencies.clearInterval(monitor.pollTimer);
    for (const timer of monitor.resetTimers.values()) dependencies.clearTimeout(timer);
    for (const timer of monitor.postResetTimers) dependencies.clearTimeout(timer);
    monitors.delete(key);
  };

  /**
   * Arms one reset timer, re-arming in `MAX_TIMER_DELAY_MS` stages for resets
   * further out than `setTimeout` can express.
   */
  const armResetTimer = (monitor: ProviderMonitor, identity: string, fireAtMs: number, fire: () => void) => {
    const remainingMs = fireAtMs - dependencies.now();
    if (remainingMs <= MAX_TIMER_DELAY_MS) {
      monitor.resetTimers.set(identity, dependencies.setTimeout(fire, Math.max(0, remainingMs)));
      return;
    }
    monitor.resetTimers.set(identity, dependencies.setTimeout(() => {
      armResetTimer(monitor, identity, fireAtMs, fire);
    }, MAX_TIMER_DELAY_MS));
  };

  /**
   * Re-fetches usage after a reset fired, backing off until one attempt comes
   * back with real data. A `stale` or errored result means the panel is still
   * showing the pre-reset snapshot, so it is worth another try.
   */
  const schedulePostResetRefresh = (
    userId: number,
    provider: LLMProvider,
    monitor: ProviderMonitor,
    attempt: number,
  ) => {
    const delayMs = POST_RESET_REFRESH_DELAYS_MS[attempt];
    if (delayMs === undefined) return;

    const timer = dependencies.setTimeout(() => {
      monitor.postResetTimers.delete(timer);
      void dependencies.getUsage(provider).then((usage) => {
        scheduleUsage(userId, provider, usage);
        if (usage.stale || usage.error) {
          schedulePostResetRefresh(userId, provider, monitor, attempt + 1);
        }
      }).catch((error) => {
        console.error('[UsageResetMonitor] Post-reset refresh failed', { provider, error });
        schedulePostResetRefresh(userId, provider, monitor, attempt + 1);
      });
    }, delayMs);
    monitor.postResetTimers.add(timer);
  };

  const scheduleUsage = (userId: number, provider: LLMProvider, usage: ProviderUsageStatus) => {
    const monitor = monitors.get(monitorKey(userId, provider));
    if (!monitor) return;

    const notified = new Set(dependencies.readState(userId).notified);
    const nextResets = collectScheduledResets(provider, usage, dependencies.now())
      .filter((reset) => !notified.has(reset.identity));
    const nextIdentities = new Set(nextResets.map((reset) => reset.identity));

    for (const [identity, timer] of monitor.resetTimers) {
      if (!nextIdentities.has(identity)) {
        dependencies.clearTimeout(timer);
        monitor.resetTimers.delete(identity);
      }
    }

    for (const reset of nextResets) {
      if (monitor.resetTimers.has(reset.identity)) continue;

      armResetTimer(monitor, reset.identity, reset.resetsAtMs, () => {
        monitor.resetTimers.delete(reset.identity);
        if (!dependencies.isEnabled(userId, provider)) return;

        // Recorded before delivery: a crash between the two is one missed
        // alert, whereas the reverse order is a duplicate on every restart.
        const latestNotified = dependencies.readState(userId).notified;
        if (latestNotified.includes(reset.identity)) return;
        dependencies.writeState(userId, {
          notified: [...latestNotified, reset.identity].slice(-MAX_PERSISTED_IDENTITIES),
        });
        dependencies.notify(userId, provider, reset);
        schedulePostResetRefresh(userId, provider, monitor, 0);
      });
    }
  };

  const refreshProvider = async (userId: number, provider: LLMProvider) => {
    if (!dependencies.isEnabled(userId, provider)) {
      stopProvider(userId, provider);
      return;
    }
    try {
      scheduleUsage(userId, provider, await dependencies.getUsage(provider));
    } catch (error) {
      console.error('[UsageResetMonitor] Usage refresh failed', { provider, error });
    }
  };

  const startProvider = (userId: number, provider: LLMProvider) => {
    const key = monitorKey(userId, provider);
    if (monitors.has(key)) {
      void refreshProvider(userId, provider);
      return;
    }
    const pollTimer = dependencies.setInterval(() => {
      void refreshProvider(userId, provider);
    }, POLL_INTERVAL_MS);
    monitors.set(key, { pollTimer, resetTimers: new Map(), postResetTimers: new Set() });
    void refreshProvider(userId, provider);
  };

  return {
    reconcileUser(userId: number) {
      for (const provider of dependencies.listMonitoredProviders()) {
        if (dependencies.isEnabled(userId, provider)) startProvider(userId, provider);
        else stopProvider(userId, provider);
      }
    },
    close() {
      for (const key of [...monitors.keys()]) {
        const [userId, provider] = key.split(':');
        stopProvider(Number(userId), provider as LLMProvider);
      }
    },
  };
}

const stateKey = (userId: number) => `usage_reset_state:${userId}`;

const readPersistedState = (userId: number): ResetState => {
  try {
    const parsed = JSON.parse(appConfigDb.get(stateKey(userId)) ?? '{}') as Partial<ResetState>;
    return {
      notified: Array.isArray(parsed.notified)
        ? parsed.notified.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return { notified: [] };
  }
};

const resetMonitor = createProviderUsageResetMonitor({
  listMonitoredProviders: () => providerCapabilitiesService
    .listAllProviderCapabilities()
    .filter((capabilities) => capabilities.supportsUsageResetAlerts)
    .map((capabilities) => capabilities.provider),
  getUsage: (provider) => providerUsageService.getProviderUsage(provider, { bypassCache: true }),
  isEnabled: (userId, provider) => (
    notificationPreferencesDb.getPreferences(userId).events.usageReset[provider] === true
  ),
  readState: readPersistedState,
  writeState: (userId, state) => appConfigDb.set(stateKey(userId), JSON.stringify(state)),
  notify: (userId, provider, reset) => notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      kind: 'usage_reset',
      code: 'usage.reset',
      meta: { windowLabels: reset.windowLabels },
      dedupeKey: reset.identity,
      urlPath: '/usage',
    }),
  }),
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  now: Date.now,
});

/** Reconciles one user's provider monitors after notification settings change. */
export function reconcileProviderUsageResetMonitor(userId: number): void {
  resetMonitor.reconcileUser(userId);
}

/** Starts reset monitoring for the active single-user installation. */
export function initializeProviderUsageResetMonitor(): void {
  const user = userDb.getFirstUser();
  if (user) resetMonitor.reconcileUser(user.id);
}

/** Stops polling and exact timers during server shutdown. */
export function closeProviderUsageResetMonitor(): void {
  resetMonitor.close();
}
