import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, ProviderUsageStatus } from '@/shared/types.js';

type UsageCacheEntry = {
  status: ProviderUsageStatus | null;
  fetchedAtMs: number;
  inFlight: Promise<ProviderUsageStatus> | null;
};

const CACHE_TTL_MS = 60_000;
// Hard floor on upstream calls, honored even for manual refreshes, so the
// refresh button can't hammer the provider's usage endpoint.
const MIN_UPSTREAM_INTERVAL_MS = 15_000;

const usageCache = new Map<LLMProvider, UsageCacheEntry>();

const getCacheEntry = (provider: LLMProvider): UsageCacheEntry => {
  let entry = usageCache.get(provider);
  if (!entry) {
    entry = { status: null, fetchedAtMs: 0, inFlight: null };
    usageCache.set(provider, entry);
  }
  return entry;
};

export const providerUsageService = {
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
    const provider = providerRegistry.resolveProvider(providerName);
    const usage = provider.usage;
    if (!usage) {
      return { provider: providerName, supported: false };
    }

    const entry = getCacheEntry(providerName);
    if (entry.inFlight) {
      return entry.inFlight;
    }

    const age = Date.now() - entry.fetchedAtMs;
    if (entry.status && (age < MIN_UPSTREAM_INTERVAL_MS || (!bypassCache && age < CACHE_TTL_MS))) {
      return entry.status;
    }

    const fetchPromise = (async (): Promise<ProviderUsageStatus> => {
      const result = await usage.getUsage();
      const previous = entry.status;

      entry.fetchedAtMs = Date.now();
      if (result.error && !result.windows && previous?.windows) {
        entry.status = {
          ...previous,
          stale: true,
          error: result.error,
        };
      } else {
        entry.status = result;
      }

      return entry.status;
    })();

    entry.inFlight = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      entry.inFlight = null;
    }
  },
};
