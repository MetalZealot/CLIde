import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import { useOptionalWebSocket } from '../../../contexts/WebSocketContext';
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
const usageCache = new Map<LLMProvider, { data: ProviderUsageStatus; lastSuccessAtMs: number }>();
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
    const successfulAt = payload.data.error
      ? Date.parse(payload.data.fetchedAt ?? '')
      : Date.now();
    usageCache.set(provider, {
      data: payload.data,
      lastSuccessAtMs: Number.isFinite(successfulAt) ? successfulAt : 0,
    });
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
 * shared client cache), on-demand via `refresh()`, which bypasses caching, and
 * via `refreshIfStale()`, which re-fetches only past the cache TTL. Pass
 * `provider: null` (or `enabled: false`) to disable entirely.
 */
export function useProviderUsage(
  provider: LLMProvider | null,
  { enabled = true }: UseProviderUsageOptions = {},
) {
  const websocket = useOptionalWebSocket();
  const [state, setState] = useState<UsageFetchState>({ usage: null, loading: false, error: null });

  const isCacheFresh = useCallback(() => {
    if (!provider) {
      return true;
    }

    const cached = usageCache.get(provider);
    return Boolean(
      cached
      && cached.lastSuccessAtMs > 0
      && Date.now() - cached.lastSuccessAtMs < CLIENT_CACHE_TTL_MS,
    );
  }, [provider]);

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
    if (
      cached
      && cached.lastSuccessAtMs > 0
      && Date.now() - cached.lastSuccessAtMs < CLIENT_CACHE_TTL_MS
    ) {
      setState({ usage: cached.data, loading: false, error: null });
      return;
    }

    void load(false);
  }, [provider, enabled, isCacheFresh, load]);

  // A live `provider_usage` push updates what is on screen, but it is not a
  // fetch: it carries only the window that moved, so it never refreshes the
  // cache's success timestamp — the normal TTL still owes a real request.
  useEffect(() => {
    if (!websocket) return undefined;
    return websocket.subscribe((event) => {
      if (event.kind !== 'provider_usage' || !event.usage || typeof event.usage !== 'object') {
        return;
      }

      const pushed = event.usage as ProviderUsageStatus;
      if (pushed.provider !== provider) {
        return;
      }

      const cached = usageCache.get(pushed.provider);
      const usage = cached ? { ...cached.data, ...pushed } : pushed;
      usageCache.set(pushed.provider, {
        data: usage,
        lastSuccessAtMs: cached?.lastSuccessAtMs ?? 0,
      });
      setState({ usage, loading: false, error: null });
    });
  }, [provider, websocket]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  // The mount fetch is the only automatic one, and this app is a long-lived PWA
  // whose composer never remounts — so without this the bars keep showing the
  // numbers from whenever the tab was opened, possibly days ago. Surfaces that
  // open on demand call this each time they open; the shared TTL keeps it to at
  // most one request a minute.
  const refreshIfStale = useCallback(() => {
    if (!provider || isCacheFresh()) {
      return;
    }

    void load(false);
  }, [provider, isCacheFresh, load]);

  useEffect(() => {
    if (!provider || !enabled) return undefined;
    const handleFocus = () => refreshIfStale();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [enabled, provider, refreshIfStale]);

  // A settings/provider switch can reuse the same hook instance. Never expose
  // the previous provider's cached bars while the new request is starting.
  const usage = state.usage?.provider === provider ? state.usage : null;

  return { ...state, usage, refresh, refreshIfStale };
}
