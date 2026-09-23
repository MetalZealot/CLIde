import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClaudePluginUpdateStatus } from '../../../../shared/provider-updates';
import { authenticatedFetch } from '../../../utils/api';

const POLL_INTERVAL_MS = 2_000;

async function readStatus(method: 'GET' | 'POST', body?: { ifStale: boolean }): Promise<ClaudePluginUpdateStatus> {
  const response = await authenticatedFetch('/api/providers/claude/plugin-update', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) throw new Error('Could not check Claude plugin updates.');
  return payload.data;
}

/** Background refresh on app open; the server skips it while marketplaces are fresh. */
export const requestStaleClaudePluginUpdate = (): void => {
  void readStatus('POST', { ifStale: true }).catch(() => { /* Best-effort; the Skills page shows status. */ });
};

/** Status and manual refresh for the Skills page; `onFinished` runs when a refresh it saw ends. */
export function useClaudePluginUpdates(enabled: boolean, onFinished: () => void) {
  const [status, setStatus] = useState<ClaudePluginUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void readStatus('GET').then((next) => { if (!cancelled) setStatus(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [enabled]);

  const isUpdating = status?.state === 'updating';
  useEffect(() => {
    if (!enabled || !isUpdating) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void readStatus('GET').then((next) => {
        if (cancelled || next.state === 'updating') return;
        setStatus(next);
        onFinishedRef.current();
      }).catch(() => { /* Keep polling; a transient failure should not strand the spinner. */ });
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [enabled, isUpdating]);

  const updateNow = useCallback(async () => {
    setError(null);
    try {
      setStatus(await readStatus('POST', { ifStale: false }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  return { status, isUpdating, error: error ?? status?.message ?? null, updateNow };
}
