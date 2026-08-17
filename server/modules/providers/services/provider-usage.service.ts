import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProviderUsage } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderUsageStatus } from '@/shared/types.js';

type UsageCacheEntry = {
  status: ProviderUsageStatus | null;
  lastAttemptAtMs: number;
  lastSuccessAtMs: number;
  inFlight: Promise<ProviderUsageStatus> | null;
};

const CACHE_TTL_MS = 60_000;
// Hard floor on upstream calls, honored even for manual refreshes, so the
// refresh button can't hammer the provider's usage endpoint.
const MIN_UPSTREAM_INTERVAL_MS = 15_000;

const hasUsageData = (status: ProviderUsageStatus | null): boolean => Boolean(
  status?.windows?.length
  || status?.credits
  || status?.resetCredits
  || status?.activity,
);

/** Creates the cache used by provider routes, Claude live events, and focused tests. */
export function createProviderUsageService({
  resolveUsage,
  now = Date.now,
}: {
  resolveUsage: (provider: LLMProvider) => IProviderUsage | undefined;
  now?: () => number;
}) {
  const usageCache = new Map<LLMProvider, UsageCacheEntry>();
  const getCacheEntry = (provider: LLMProvider): UsageCacheEntry => {
    let entry = usageCache.get(provider);
    if (!entry) {
      entry = { status: null, lastAttemptAtMs: 0, lastSuccessAtMs: 0, inFlight: null };
      usageCache.set(provider, entry);
    }
    return entry;
  };

  return {
    /**
     * Returns cached-or-fresh plan usage for a provider.
     *
     * Providers without a usage reporter yield `supported: false`. Successful
     * fetches are cached for CACHE_TTL_MS; `bypassCache` skips the TTL but not
     * the minimum upstream interval. A failed refresh falls back to the last
     * good value flagged `stale: true`.
     */
    async getProviderUsage(
      providerName: LLMProvider,
      { bypassCache = false }: { bypassCache?: boolean } = {},
    ): Promise<ProviderUsageStatus> {
      const usage = resolveUsage(providerName);
      if (!usage) {
        return { provider: providerName, supported: false };
      }

      const entry = getCacheEntry(providerName);
      if (entry.inFlight) {
        return entry.inFlight;
      }

      const checkedAt = now();
      const attemptAge = checkedAt - entry.lastAttemptAtMs;
      const successAge = checkedAt - entry.lastSuccessAtMs;
      if (
        entry.status
        && (
          attemptAge < MIN_UPSTREAM_INTERVAL_MS
          || (!bypassCache && entry.lastSuccessAtMs > 0 && successAge < CACHE_TTL_MS)
        )
      ) {
        return entry.status;
      }

      const fetchPromise = (async (): Promise<ProviderUsageStatus> => {
        entry.lastAttemptAtMs = now();
        const result = await usage.getUsage();
        const previous = entry.status;

        if (result.error && !hasUsageData(result) && previous && hasUsageData(previous)) {
          entry.status = {
            ...previous,
            stale: true,
            error: result.error,
          };
        } else {
          entry.status = result;
          if (!result.error || hasUsageData(result)) {
            entry.lastSuccessAtMs = now();
          }
        }

        return entry.status ?? result;
      })();

      entry.inFlight = fetchPromise;
      try {
        return await fetchPromise;
      } finally {
        entry.inFlight = null;
      }
    },

    /**
     * Merges provider-pushed rate-limit windows into the cache for Claude's
     * runtime stream and returns the normalized status sent to browser clients.
     *
     * A push is not a fetch. It carries only the window that just moved — never
     * credits, activity, or the other windows — so it deliberately leaves the
     * freshness timestamps, `stale`, and `error` alone: the cache is still due a
     * real refresh on the normal schedule, and a failed refresh is still stale.
     * For the same reason a pushed window never downgrades a known `resetsAt` to
     * null; the SDK marks that field optional, and the fetched value is the
     * better fact until the next fetch says otherwise.
     */
    mergeProviderUsageWindows(
      provider: LLMProvider,
      windows: ProviderUsageStatus['windows'],
    ): ProviderUsageStatus {
      const entry = getCacheEntry(provider);
      const currentWindows = entry.status?.windows ?? [];
      const incomingWindows = windows ?? [];
      const incomingIds = new Set(incomingWindows.map((window) => window.id));

      entry.status = {
        ...entry.status,
        provider,
        supported: true,
        windows: [
          ...currentWindows.filter((window) => !incomingIds.has(window.id)),
          ...incomingWindows.map((incoming) => {
            const current = currentWindows.find((window) => window.id === incoming.id);
            return current
              ? { ...current, ...incoming, resetsAt: incoming.resetsAt ?? current.resetsAt }
              : incoming;
          }),
        ],
      };
      return entry.status;
    },
  };
}

export const providerUsageService = createProviderUsageService({
  resolveUsage: (provider) => providerRegistry.resolveProvider(provider).usage,
});
