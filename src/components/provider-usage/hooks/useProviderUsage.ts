import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import { providerUsageEndpoint } from '../types';
import type { ProviderUsageStatus } from '../types';

type ProviderUsageApiResponse = {
  success: boolean;
  data: ProviderUsageStatus;
};

type UsageFetchState = {
  usage: ProviderUsageStatus | null;
  loading: boolean;
  error: string | null;
};

// Module-level cache shared by every consumer (Token Usage modal + Settings)
// so opening both surfaces back-to-back costs one round-trip. The server keeps
// its own cache; this only avoids duplicate requests from the same page.
const CLIENT_CACHE_TTL_MS = 60_000;
const usageCache = new Map<LLMProvider, { data: ProviderUsageStatus; fetchedAtMs: number }>();
const usageInFlight = new Map<LLMProvider, Promise<ProviderUsageStatus>>();

const fetchProviderUsage = (provider: LLMProvider, refresh: boolean): Promise<ProviderUsageStatus> => {
  const existing = usageInFlight.get(provider);
  if (existing && !refresh) {
    return existing;
  }

  const request = (async (): Promise<ProviderUsageStatus> => {
    const response = await authenticatedFetch(providerUsageEndpoint(provider, refresh));
    if (!response.ok) {
      throw new Error('Failed to load plan usage');
    }

    const payload = (await response.json()) as ProviderUsageApiResponse;
    usageCache.set(provider, { data: payload.data, fetchedAtMs: Date.now() });
    return payload.data;
  })();

  usageInFlight.set(provider, request);
  void request.finally(() => {
    if (usageInFlight.get(provider) === request) {
      usageInFlight.delete(provider);
    }
  });

  return request;
};

type UseProviderUsageOptions = {
  enabled?: boolean;
};

/**
 * Loads plan rate-limit usage for a provider: once on mount (respecting the
 * shared client cache) plus on-demand via `refresh()`, which bypasses caching.
 * Pass `provider: null` (or `enabled: false`) to disable entirely.
 */
export function useProviderUsage(
  provider: LLMProvider | null,
  { enabled = true }: UseProviderUsageOptions = {},
) {
  const [state, setState] = useState<UsageFetchState>({ usage: null, loading: false, error: null });

  const load = useCallback(async (refresh: boolean) => {
    if (!provider) {
      return;
    }

    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await fetchProviderUsage(provider, refresh);
      setState({ usage: data, loading: false, error: null });
    } catch (caughtError) {
      setState((previous) => ({
        ...previous,
        loading: false,
        error: caughtError instanceof Error ? caughtError.message : 'Failed to load plan usage',
      }));
    }
  }, [provider]);

  useEffect(() => {
    if (!provider || !enabled) {
      return;
    }

    const cached = usageCache.get(provider);
    if (cached && Date.now() - cached.fetchedAtMs < CLIENT_CACHE_TTL_MS) {
      setState({ usage: cached.data, loading: false, error: null });
      return;
    }

    void load(false);
  }, [provider, enabled, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { ...state, refresh };
}
