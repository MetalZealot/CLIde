import { AlertTriangle, Check, ExternalLink, Loader2, Package, Radio, SquareTerminal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeSdkReleaseStatus } from '../../../../../../shared/provider-updates';
import { useProviderCliUpdate } from '../../../../../hooks/useProviderCliUpdate';
import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import { SettingsSegmentedControl } from '../../primitives';

const SDK_CHANGELOG_URL = 'https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md';

type VersionRowProps = {
  icon: ReactNode;
  label: string;
  version: string | null;
  detail?: ReactNode;
  trailing?: ReactNode;
};

function VersionRow({ icon, label, version, detail, trailing }: VersionRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {label}
          {version && <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{version}</span>}
        </div>
        {detail && <div className="mt-0.5 text-xs">{detail}</div>}
      </div>
      {trailing}
    </div>
  );
}

function Latest() {
  const { t } = useTranslation('settings');
  return (
    <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5" aria-hidden />
      {t('agents.runtimeVersions.latest')}
    </span>
  );
}

const Working = ({ children }: { children: ReactNode }) => (
  <span className="flex items-center gap-1.5 text-muted-foreground">
    <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
    {children}
  </span>
);

/**
 * The installed CLI and its update, with the same actions as the New Session
 * notice. `quietWhenCurrent` hides it until there is news, for a provider
 * whose version already shows elsewhere on the card.
 */
export function AgentCliUpdateRow({
  provider,
  fallbackVersion = null,
  quietWhenCurrent = false,
}: { provider: 'claude' | 'codex'; fallbackVersion?: string | null; quietWhenCurrent?: boolean }) {
  const { t } = useTranslation('settings');
  const { status, error, busy, update, cancel, refresh } = useProviderCliUpdate(provider, {
    updateFailed: t('agents.runtimeVersions.updateFailed'),
    cancelFailed: t('agents.runtimeVersions.cancelFailed'),
  });

  let detail: ReactNode = null;
  let action: ReactNode = null;
  const actionButton = (label: string, onClick: () => void, primary = false) => (
    <Button size="sm" variant={primary ? 'default' : 'outline'} className="h-8" disabled={busy && primary} onClick={onClick}>
      {label}
    </Button>
  );

  if (error || status?.state === 'error') {
    detail = <span className="text-destructive">{error || status?.message}</span>;
    if (status?.canUpdate) action = actionButton(t('agents.runtimeVersions.retry'), () => void update());
  } else if (status?.state === 'waiting') {
    detail = <Working>{status.message}</Working>;
    action = actionButton(t('agents.runtimeVersions.cancel'), cancel);
  } else if (status?.state === 'updating' || busy) {
    detail = <Working>{status?.message}</Working>;
  } else if (status?.state === 'updated') {
    detail = <span className="text-primary">{status.message}</span>;
  } else if (status?.updateAvailable) {
    detail = (
      <span className="tabular-nums text-primary">
        {t(status.canUpdate ? 'agents.runtimeVersions.available' : 'agents.runtimeVersions.availableExternal', {
          version: status.latestVersion,
        })}
      </span>
    );
    if (status.canUpdate) action = actionButton(t('agents.runtimeVersions.update'), () => void update(), true);
  } else if (status?.message) {
    detail = <span className="text-muted-foreground">{status.message}</span>;
  }

  if (quietWhenCurrent && !detail) return null;

  return (
    <>
      <VersionRow
        icon={<SquareTerminal className="h-4 w-4" />}
        label={t(`agents.runtimeVersions.cli.${provider}`)}
        version={status?.installedVersion ?? fallbackVersion}
        detail={detail}
        trailing={action ?? (status && !detail ? <Latest /> : null)}
      />
      {provider === 'claude' && <ClaudeUpdateChannelRow disabled={busy} onChanged={refresh} />}
    </>
  );
}

type UpdateChannel = 'latest' | 'stable';
type UpdateChannelSettings = { channel: UpdateChannel; managed: boolean };

/** Claude Code's `autoUpdatesChannel`; the row above re-checks against whichever is picked. */
function ClaudeUpdateChannelRow({ disabled, onChanged }: { disabled: boolean; onChanged: () => void }) {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<UpdateChannelSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/providers/claude/update-channel')
      .then((response) => response.json())
      .then((body) => { if (!cancelled && body.success) setSettings(body.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!settings) return null;

  const choose = async (channel: UpdateChannel) => {
    if (channel === settings.channel) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/claude/update-channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '');
      setSettings(body.data);
      onChanged();
    } catch (failure) {
      setError((failure instanceof Error && failure.message) || t('agents.runtimeVersions.channel.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex-shrink-0 text-muted-foreground"><Radio className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{t('agents.runtimeVersions.channel.label')}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t(settings.managed ? 'agents.runtimeVersions.channel.managed' : 'agents.runtimeVersions.channel.hint')}
        </div>
        <SettingsSegmentedControl<UpdateChannel>
          value={settings.channel}
          className="mt-2 w-full"
          ariaLabel={t('agents.runtimeVersions.channel.label')}
          disabled={settings.managed || saving || disabled}
          onChange={(channel) => void choose(channel)}
          options={[
            { value: 'latest', label: t('agents.runtimeVersions.channel.latest') },
            { value: 'stable', label: t('agents.runtimeVersions.channel.stable') },
          ]}
        />
        {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
      </div>
    </div>
  );
}

/** Read-only: the SDK ships inside CLIde, so being behind is a prompt to test, not a button. */
export function AgentSdkReleaseRow({ installedVersion }: { installedVersion: string | null }) {
  const { t } = useTranslation('settings');
  const [release, setRelease] = useState<ClaudeSdkReleaseStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/providers/claude/sdk-release')
      .then((response) => response.json())
      .then((body) => { if (!cancelled && body.success) setRelease(body.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const behind = release?.behind === true;

  // One wrapper, so a divided group draws no rule between the row and its note.
  return (
    <div>
      <VersionRow
        icon={<Package className="h-4 w-4" />}
        label={t('agents.runtimeVersions.sdk')}
        version={release?.installedVersion ?? installedVersion}
        detail={behind && (
          <span className="tabular-nums text-warning">
            {t('agents.runtimeVersions.available', { version: release.latestVersion })}
          </span>
        )}
        trailing={behind ? (
          <a
            href={SDK_CHANGELOG_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-9 flex-shrink-0 items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('agents.runtimeVersions.changelog')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : release?.latestVersion ? <Latest /> : null}
      />
      {behind && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>{t('agents.runtimeVersions.sdkBehind')}</span>
        </div>
      )}
    </div>
  );
}
