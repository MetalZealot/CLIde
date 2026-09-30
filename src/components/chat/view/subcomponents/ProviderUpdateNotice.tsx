import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { ProviderCliUpdateStatus } from '../../../../../shared/provider-updates';
import { ComposerNotice, composerNoticeActionClass } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';

/** Throws the server's message, or an empty one for the caller's own fallback. */
async function readStatus(provider: string, method = 'GET'): Promise<ProviderCliUpdateStatus> {
  const response = await authenticatedFetch(`/api/providers/${provider}/cli-update`, { method });
  const body = await response.json();
  if (!response.ok || !body.success || !body.data) throw new Error(body.error || '');
  return body.data;
}

/** The notice the user last dismissed, per provider; a new version or outcome shows again. */
const dismissedStorageKey = (provider: string) => `cli-update-dismissed:${provider}`;
const readDismissed = (provider: string) => {
  try { return localStorage.getItem(dismissedStorageKey(provider)); } catch { return null; }
};

/** New Session offers provider updates without opening an interactive Shell. */
export default function ProviderUpdateNotice({ provider, onUpdated }: { provider: string; onUpdated?: () => void }) {
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<ProviderCliUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(() => readDismissed(provider));
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

  const noticeKey = error
    ? `error:${error}`
    : `${status?.state}:${status?.state === 'updated' ? status.installedVersion : status?.latestVersion}`;
  if (!busy && dismissed === noticeKey) return null;

  const name = provider === 'claude' ? 'Claude Code' : 'Codex';
  const update = async () => {
    setSubmitting(true);
    setError(null);
    try { setStatus(await readStatus(provider, 'POST')); }
    catch (failure) {
      setError((failure instanceof Error && failure.message)
        || t('cliUpdate.updateFailed', { defaultValue: 'CLI update failed.' }));
    }
    finally { setSubmitting(false); }
  };
  const cancel = () => void readStatus(provider, 'DELETE').then(setStatus)
    .catch(() => setError(t('cliUpdate.cancelFailed', { defaultValue: 'Could not cancel the update.' })));
  const dismiss = () => {
    try { localStorage.setItem(dismissedStorageKey(provider), noticeKey); } catch { /* holds for this page */ }
    setDismissed(noticeKey);
  };

  return (
    <ComposerNotice
      leading={busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
      onDismiss={busy ? undefined : dismiss}
      dismissLabel={t('composer.dismissNotice', { defaultValue: 'Dismiss' })}
      actions={<>
        {status?.state === 'waiting' && (
          <button type="button" className={composerNoticeActionClass} onClick={cancel}>
            {t('cliUpdate.cancel', { defaultValue: 'Cancel' })}
          </button>
        )}
        {status?.canUpdate && (status.updateAvailable || status.state === 'error') && (
          <button type="button" disabled={busy} onClick={() => void update()} className={composerNoticeActionClass}>
            {t('cliUpdate.update', { defaultValue: 'Update' })}
          </button>
        )}
      </>}
    >
      {error || (status?.state !== 'idle' && status?.message) || t('cliUpdate.available', {
        defaultValue: '{{provider}} update available: {{version}}', provider: name, version: status?.latestVersion,
      })}
      {status?.updateAvailable && !status.canUpdate && !busy && ` ${t('cliUpdate.external', {
        defaultValue: 'Update using its original installer.',
      })}`}
    </ComposerNotice>
  );
}
