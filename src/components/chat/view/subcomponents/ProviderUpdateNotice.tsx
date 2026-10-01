import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { useProviderCliUpdate } from '../../../../hooks/useProviderCliUpdate';
import { ComposerNotice, composerNoticeActionClass } from '../../../../shared/view/ui';

/** The notice the user last dismissed, per provider; a new version or outcome shows again. */
const dismissedStorageKey = (provider: string) => `cli-update-dismissed:${provider}`;
const readDismissed = (provider: string) => {
  try { return localStorage.getItem(dismissedStorageKey(provider)); } catch { return null; }
};

/** New Session offers provider updates without opening an interactive Shell. */
export default function ProviderUpdateNotice({ provider, onUpdated }: { provider: string; onUpdated?: () => void }) {
  const { t } = useTranslation('chat');
  const { supported, status, error, busy, update, cancel } = useProviderCliUpdate(provider, {
    updateFailed: t('cliUpdate.updateFailed', { defaultValue: 'CLI update failed.' }),
    cancelFailed: t('cliUpdate.cancelFailed', { defaultValue: 'Could not cancel the update.' }),
  });
  const [dismissed, setDismissed] = useState(() => readDismissed(provider));
  const notifiedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (status?.state === 'updated' && status.installedVersion !== notifiedVersion.current) {
      notifiedVersion.current = status.installedVersion;
      onUpdated?.();
    }
  }, [status, onUpdated]);

  if (!supported || (!error && !status?.updateAvailable && status?.state !== 'updated'
    && status?.state !== 'error' && !busy)) return null;

  const noticeKey = error
    ? `error:${error}`
    : `${status?.state}:${status?.state === 'updated' ? status.installedVersion : status?.latestVersion}`;
  if (!busy && dismissed === noticeKey) return null;

  const name = provider === 'claude' ? 'Claude Code' : 'Codex';
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
