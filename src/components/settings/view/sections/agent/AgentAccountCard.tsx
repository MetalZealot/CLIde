import { AlertTriangle, LogIn, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProviderCapabilities } from '../../../../../hooks/useProviderCapabilities';
import { Button } from '../../../../../shared/view/ui';
import SessionProviderLogo from '../../../../llm-logo-provider/SessionProviderLogo';
import UsageWindowList from '../../../../provider-usage/UsageWindowList';
import { useProviderUsage } from '../../../../provider-usage/hooks/useProviderUsage';
import { supportsProviderUsageReset } from '../../../../provider-usage/types';
import {
  type CodexTransportDiagnostics,
  isTransportDegraded,
  useCodexTransport,
} from '../../../hooks/useCodexRuntime';
import type { AgentProviderId } from '../../../registry/registry';
import type { AuthStatus, NotificationPreferencesState } from '../../../types/types';
import { toProviderStatus } from '../../../utils/providerStatus';
import {
  describeVersionMoves,
  formatVersionAge,
  formatVersionPair,
} from '../../../utils/providerVersions';
import { SettingsGroup, SettingsRow, SettingsStatus, SettingsToggle } from '../../primitives';

type AgentAccountCardProps = {
  provider: AgentProviderId;
  authStatus: AuthStatus;
  onLogin: () => void;
  /** Outcome of the most recent login for this provider, if one just finished. */
  loginSucceeded?: boolean | null;
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  onOpenNotifications: () => void;
};

/** Which of the three alert sentences a degraded transport gets. */
const transportAlertKey = (transport: CodexTransportDiagnostics): string => {
  if (transport.health === 'fallback' || transport.health === 'stopped') {
    return transport.health;
  }
  return 'error';
};

const formatUpdatedAgo = (fetchedAt: string): string | null => {
  const elapsedMs = Date.now() - Date.parse(fetchedAt);
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return null;
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  return minutes < 1 ? 'just now' : `${minutes}m ago`;
};

/**
 * The provider screen's lead card: who you are signed in as, how to change
 * that, and the plan usage that goes with it. Inline rather than a nav row
 * because it is why the user opened the screen.
 *
 * Ported from `AccountContent`, which painted each provider in its own brand
 * palette (`bg-blue-50` / `border-purple-200` / `bg-gray-800` …). Those literals
 * are gone: the provider's identity is carried by its logo, and everything else
 * is theme tokens, per the restructure's no-hardcoded-colour rule.
 *
 * Codex's runtime and transport detail live on the Runtime sub-screen. What
 * remains here is the exception: a healthy transport says nothing at all.
 *
 * A provider that reports version numbers gets one Runtime row here instead of
 * a sub-screen, because CLIde manages Codex's binary but only observes Claude's
 * — there is nothing to act on, so there is nowhere to drill into.
 */
export default function AgentAccountCard({
  provider,
  authStatus,
  onLogin,
  loginSucceeded = null,
  notificationPreferences,
  onNotificationPreferencesChange,
  onOpenNotifications,
}: AgentAccountCardProps) {
  const { t } = useTranslation(['settings', 'common']);
  const status = toProviderStatus(authStatus);
  const providerName = t(`agents.providers.${provider}`);
  const planUsage = useProviderUsage(provider, {
    enabled: authStatus.authenticated && !authStatus.loading,
  });
  const showUsageCard = Boolean(
    authStatus.authenticated
    && !authStatus.loading
    && planUsage.usage?.supported !== false,
  );
  const showApiKeyUsageNote = Boolean(
    authStatus.authenticated
    && planUsage.usage?.supported === false
    && planUsage.usage.reason === 'api_key',
  );
  const usageUpdatedAgo = planUsage.usage?.fetchedAt
    ? formatUpdatedAgo(planUsage.usage.fetchedAt)
    : null;
  const versionPair = authStatus.versions ? formatVersionPair(authStatus.versions) : null;
  const versionMoves = authStatus.versions ? describeVersionMoves(authStatus.versions) : [];
  const versionMovedAge = authStatus.versions && versionMoves.length > 0
    ? formatVersionAge(authStatus.versions.observedAt)
    : null;
  const codexTransport = useCodexTransport(provider === 'codex');
  const transportAlert = isTransportDegraded(codexTransport)
    ? t(`agents.codexTransport.alerts.${transportAlertKey(codexTransport)}`)
    : null;
  const capabilities = useProviderCapabilities();
  const supportsUsageReset = authStatus.authenticated && supportsProviderUsageReset(
    capabilities?.[provider]?.supportsUsageResetAlerts === true,
    authStatus.method,
    planUsage.usage?.supported === true,
  );
  const hasNotificationChannel = notificationPreferences.channels.webPush
    || notificationPreferences.channels.desktop;
  const usageResetEnabled = notificationPreferences.events.usageReset[provider] === true;

  const setUsageResetEnabled = (enabled: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      events: {
        ...notificationPreferences.events,
        usageReset: {
          ...notificationPreferences.events.usageReset,
          [provider]: enabled,
        },
      },
    });
  };

  const identityLine = authStatus.authenticated
    ? authStatus.email || t('agents.authStatus.authenticatedUser')
    : t(`agents.account.${provider}.description`);

  return (
    <>
      <SettingsGroup divided>
        <div className="flex items-center gap-3 px-4 py-4">
          <SessionProviderLogo provider={provider} className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{providerName}</div>
            <div className="mt-0.5 truncate text-sm text-muted-foreground">{identityLine}</div>
          </div>
          <SettingsStatus state={status.state} label={t(status.labelKey)} />
        </div>

        {authStatus.method !== 'api_key' && (
          <SettingsRow
            label={authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
            description={authStatus.authenticated
              ? t('agents.login.reAuthDescription')
              : t('agents.login.description', { agent: providerName })}
          >
            <Button onClick={onLogin} size="sm">
              <LogIn className="mr-2 h-4 w-4" />
              {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
            </Button>
          </SettingsRow>
        )}

        {/*
          Driven by whether the provider reported a pair, not by `provider ===
          'claude'`: Claude is the only one that does today, and the row lights
          up for any provider that starts.
        */}
        {versionPair && (
          <SettingsRow label={t('agents.runtimeVersions.title', { defaultValue: 'Runtime' })}>
            <span className="text-sm text-muted-foreground">{versionPair}</span>
          </SettingsRow>
        )}

        {versionMoves.length > 0 && (
          <div className="flex items-start gap-2 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="min-w-0">
              {versionMoves.map((move) => (
                <div key={move.half}>
                  {move.half === 'runtime'
                    ? t('agents.runtimeVersions.movedRuntime', {
                      defaultValue: '{{agent}} runtime moved {{from}} → {{to}}',
                      agent: providerName,
                      from: move.from ?? t('agents.runtimeVersions.unknown', { defaultValue: 'unknown' }),
                      to: move.to ?? t('agents.runtimeVersions.unknown', { defaultValue: 'unknown' }),
                    })
                    : t('agents.runtimeVersions.movedSdk', {
                      defaultValue: 'Agent SDK moved {{from}} → {{to}}',
                      from: move.from ?? t('agents.runtimeVersions.unknown', { defaultValue: 'unknown' }),
                      to: move.to ?? t('agents.runtimeVersions.unknown', { defaultValue: 'unknown' }),
                    })}
                </div>
              ))}
              {versionMovedAge && (
                <div className="mt-0.5 text-xs text-warning/80">
                  {t('agents.runtimeVersions.movedAge', {
                    defaultValue: 'Seen {{age}}',
                    age: versionMovedAge,
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {transportAlert && (
          <div className="flex items-start gap-2 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="min-w-0">
              <div>{transportAlert}</div>
              {codexTransport?.lastError && (
                <div className="mt-0.5 break-words text-xs text-warning/80">
                  {codexTransport.lastError}
                </div>
              )}
            </div>
          </div>
        )}

        {authStatus.error && (
          <div className="px-4 py-3 text-sm text-destructive">
            {t('agents.error', { error: authStatus.error })}
          </div>
        )}

        {/*
          Local confirmation for the login flow, which is the one action here
          with an outcome worth reporting. It replaces the global header "Saved"
          indicator the shell used to show — see the save model in the IA spec.
        */}
        {loginSucceeded !== null && (
          <div className="px-4 py-3 text-xs">
            <span className={loginSucceeded ? 'text-primary' : 'text-destructive'}>
              {loginSucceeded
                ? t('agents.login.status.success', { defaultValue: 'Signed in' })
                : t('agents.login.status.error', { defaultValue: 'Sign-in did not complete' })}
            </span>
          </div>
        )}
      </SettingsGroup>

      {showUsageCard && (
        <SettingsGroup
          title={t('agents.usage.title')}
          description={usageUpdatedAgo
            ? t('agents.usage.updatedAgo', { time: usageUpdatedAgo })
            : undefined}
          action={(
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={planUsage.refresh}
              disabled={planUsage.loading}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('agents.usage.refresh')}
            >
              <RefreshCw className={planUsage.loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              {t('agents.usage.refreshButton')}
            </Button>
          )}
        >
          <div className="p-4">
            <UsageWindowList usage={planUsage.usage} loading={planUsage.loading} error={planUsage.error} />
          </div>
        </SettingsGroup>
      )}

      {showApiKeyUsageNote && (
        <SettingsGroup>
          <div className="p-4 text-sm text-muted-foreground">
            {t('agents.usage.apiKeyUnavailable')}
          </div>
        </SettingsGroup>
      )}

      {supportsUsageReset && (
        <SettingsGroup title={t('common:usageDashboard.notifications.title', { defaultValue: 'Usage notifications' })}>
          <SettingsRow
            label={t('common:usageDashboard.notifications.reset', { defaultValue: 'Usage reset notification' })}
            description={hasNotificationChannel
              ? t('common:usageDashboard.notifications.resetDescription', {
                defaultValue: 'Notify me whenever this provider resets a usage limit.',
              })
              : t('common:usageDashboard.notifications.channelRequired', {
                defaultValue: 'Enable Web Push or Desktop notifications to receive this alert.',
              })}
          >
            <SettingsToggle
              checked={usageResetEnabled}
              onChange={setUsageResetEnabled}
              ariaLabel={t('common:usageDashboard.notifications.reset', { defaultValue: 'Usage reset notification' })}
            />
          </SettingsRow>
          {!hasNotificationChannel && (
            <div className="border-t border-border px-4 py-3">
              <Button type="button" variant="outline" size="sm" onClick={onOpenNotifications}>
                {t('common:usageDashboard.notifications.openSettings', { defaultValue: 'Notification settings' })}
              </Button>
            </div>
          )}
        </SettingsGroup>
      )}
    </>
  );
}
