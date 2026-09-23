import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { SkillsTarget } from '../../skills/types';
import type { ToolsConnector, ToolsPlugin, ToolsProvider } from '../types';

type Listing<T> = { supported: boolean; items: T[]; isLoading: boolean; error: string | null };

const EMPTY = { supported: true, items: [], isLoading: true, error: null };

const fetchListing = async <T>(
  provider: ToolsProvider,
  resource: 'plugins' | 'connectors',
  target: SkillsTarget,
  refresh: boolean,
  signal: AbortSignal,
): Promise<{ supported: boolean; items: T[] }> => {
  const params = new URLSearchParams();
  if (target.kind === 'workspace') params.set('workspacePath', target.path);
  if (refresh) params.set('refresh', 'true');
  const query = params.toString();
  const response = await authenticatedFetch(
    `/api/providers/${provider}/${resource}${query ? `?${query}` : ''}`,
    { signal },
  );
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message ?? `Could not load ${resource}.`);
  }
  const data = payload.data ?? {};
  return { supported: data.supported !== false, items: Array.isArray(data[resource]) ? data[resource] : [] };
};

/**
 * Plugins and connector status for one provider and checkout. The two load
 * separately because connector status takes seconds (a health check of every
 * server) and must not hold back the plugin list.
 */
export function useProviderTools(provider: ToolsProvider, target: SkillsTarget) {
  const [plugins, setPlugins] = useState<Listing<ToolsPlugin>>(EMPTY);
  const [connectors, setConnectors] = useState<Listing<ToolsConnector>>(EMPTY);
  const controllerRef = useRef<AbortController | null>(null);
  const targetKey = target.kind === 'workspace' ? target.path : '';

  const load = useCallback((refresh: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const run = <T,>(
      resource: 'plugins' | 'connectors',
      set: (update: (previous: Listing<T>) => Listing<T>) => void,
    ) => {
      set((previous) => ({ ...previous, isLoading: true, error: null }));
      fetchListing<T>(provider, resource, target, refresh, controller.signal)
        .then(({ supported, items }) => set(() => ({ supported, items, isLoading: false, error: null })))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          set((previous) => ({
            ...previous,
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    };

    run<ToolsPlugin>('plugins', setPlugins);
    run<ToolsConnector>('connectors', setConnectors);
    // `target` is read through its key; the object identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, targetKey]);

  useEffect(() => {
    setPlugins(EMPTY);
    setConnectors(EMPTY);
    load(false);
    return () => controllerRef.current?.abort();
  }, [load]);

  return { plugins, connectors, refresh: () => load(true) };
}
