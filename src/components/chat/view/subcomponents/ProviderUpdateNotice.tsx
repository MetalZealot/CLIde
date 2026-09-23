import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { ProviderCliUpdateStatus } from '../../../../../shared/provider-updates';
import { authenticatedFetch } from '../../../../utils/api';

async function readStatus(provider: string, method = 'GET'): Promise<ProviderCliUpdateStatus> {
  const response = await authenticatedFetch(`/api/providers/${provider}/cli-update`, { method });
  const body = await response.json();
  if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'Could not check CLI updates.');
  return body.data;
}

/** New Session offers provider updates without opening an interactive Shell. */
export default function ProviderUpdateNotice({ provider, onUpdated }: { provider: string; onUpdated?: () => void }) {
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<ProviderCliUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const notifiedVersion = useRef<string | null>(null);
  const supported = provider === 'claude' || provider === 'codex';
  const busy = submitting || status?.state === 'waiting' || status?.state === 'updating';

  useEffect(() => {
    if (status?.state === 'updated' && status.installedVersion !== notifiedVersion.current) {
      notifiedVersion.current = status.installedVersion;
      onUpdated?.();
    }
  }, [status, onUpdated]);

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
  }, [provider, supported, submitting]);

  if (!supported || (!error && !status?.updateAvailable && status?.state !== 'updated'
    && status?.state !== 'error' && !busy)) return null;

  const name = provider === 'claude' ? 'Claude Code' : 'Codex';
  const update = async () => {
    setSubmitting(true);
    setError(null);
    try { setStatus(await readStatus(provider, 'POST')); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'CLI update failed.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto mb-2 flex max-w-[34.25rem] items-center gap-2 px-3 text-xs text-muted-foreground">
      {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
      <span role="status" aria-live="polite" className="min-w-0 flex-1">
        {error || (status?.state !== 'idle' && status?.message) || t('cliUpdate.available', {
          defaultValue: '{{provider}} update available: {{version}}', provider: name, version: status?.latestVersion,
        })}
        {status?.updateAvailable && !status.canUpdate && !busy && ` ${t('cliUpdate.external', {
          defaultValue: 'Update using its original installer.',
        })}`}
      </span>
      {status?.state === 'waiting' && (
        <button type="button" className="min-h-7 shrink-0 rounded px-2 text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void readStatus(provider, 'DELETE').then(setStatus).catch(() => setError('Could not cancel the update.'))}>
          {t('cliUpdate.cancel', { defaultValue: 'Cancel' })}
        </button>
      )}
      {status?.canUpdate && (status.updateAvailable || status.state === 'error') && (
        <button type="button" disabled={busy} onClick={() => void update()}
          className="min-h-7 shrink-0 rounded px-2 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          {t('cliUpdate.update', { defaultValue: 'Update' })}
        </button>
      )}
    </div>
  );
}
