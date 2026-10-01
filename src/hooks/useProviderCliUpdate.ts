import { useCallback, useEffect, useState } from 'react';

import type { ProviderCliUpdateStatus } from '../../shared/provider-updates';
import { authenticatedFetch } from '../utils/api';

/** Throws the server's message, or an empty one for the caller's own fallback. */
async function readStatus(provider: string, method = 'GET'): Promise<ProviderCliUpdateStatus> {
  const response = await authenticatedFetch(`/api/providers/${provider}/cli-update`, { method });
  const body = await response.json();
  if (!response.ok || !body.success || !body.data) throw new Error(body.error || '');
  return body.data;
}

export const supportsCliUpdate = (provider: string): boolean => provider === 'claude' || provider === 'codex';

/**
 * A provider CLI's update status, polled while an update runs, plus the
 * actions on it. The New Session notice and the provider settings card both
 * read it, so the two always agree.
 */
export function useProviderCliUpdate(provider: string, messages: { updateFailed: string; cancelFailed: string }) {
  const [status, setStatus] = useState<ProviderCliUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const supported = supportsCliUpdate(provider);
  const busy = submitting || status?.state === 'waiting' || status?.state === 'updating';

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await readStatus(provider);
        if (cancelled) return;
        setStatus(next);
        setError(null);
        timer = setTimeout(refresh, next.state === 'waiting' || next.state === 'updating' ? 1500 : 60_000);
      } catch {
        if (!cancelled) timer = setTimeout(refresh, 60_000);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [provider, supported, submitting, revision]);

  const { updateFailed, cancelFailed } = messages;
  const update = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try { setStatus(await readStatus(provider, 'POST')); }
    catch (failure) { setError((failure instanceof Error && failure.message) || updateFailed); }
    finally { setSubmitting(false); }
  }, [provider, updateFailed]);

  const cancel = useCallback(() => void readStatus(provider, 'DELETE').then(setStatus)
    .catch(() => setError(cancelFailed)), [provider, cancelFailed]);

  /** Re-reads now, e.g. after the release channel changed. */
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  return { supported, status, error, busy, update, cancel, refresh };
}
