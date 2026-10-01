import { AlertTriangle, Gauge, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProviderCapabilities } from '../../../../../hooks/useProviderCapabilities';
import { Button } from '../../../../../shared/view/ui';
import SessionProviderLogo from '../../../../llm-logo-provider/SessionProviderLogo';
import { formatUsageWindowLabel, isUsageWindowResetPending } from '../../../../provider-usage/format';
import type { ProviderUsageStatus, ProviderUsageWindow } from '../../../../provider-usage/types';
import {
  type CodexTransportDiagnostics,
  isTransportDegraded,
  useCodexTransport,
} from '../../../hooks/useCodexRuntime';
import type { AgentProviderId } from '../../../registry/registry';
import type { AuthStatus } from '../../../types/types';
import { toProviderStatus } from '../../../utils/providerStatus';
import { formatVersionPair } from '../../../utils/providerVersions';
import { SettingsGroup, SettingsNavRow, SettingsRow, SettingsStatus } from '../../primitives';

import AgentCodexRuntimeSection from './AgentCodexRuntimeSection';
import { AgentCliUpdateRow, AgentSdkReleaseRow } from './AgentRuntimeRows';
import AgentServiceStatusRow from './AgentServiceStatusRow';

type AgentAccountCardProps = {
  provider: AgentProviderId;
  authStatus: AuthStatus;
  onLogin: () => void;
  /** Outcome of the most recent login for this provider, if one just finished. */
  loginSucceeded?: boolean | null;
  /** The provider's plan usage, owned by the screen so the reset alert can read it too. */
  planUsage: ProviderUsageStatus | null;
  onOpenUsage: () => void;
};

/** Which of the three alert sentences a degraded transport gets. */
const transportAlertKey = (transport: CodexTransportDiagnostics): string => {
  if (transport.health === 'fallback' || transport.health === 'stopped') {
    return transport.health;
  }
  return 'error';
};

/** The most-used plan window, which is the one that will stop you first. */
const peakUsageWindow = (usage: ProviderUsageStatus | null) => (usage?.windows ?? [])
  .map((window) => ({ window, percent: isUsageWindowResetPending(window.resetsAt) ? 0 : Math.round(window.utilization) }))
  .reduce<{ window: ProviderUsageWindow; percent: number } | null>(
    (peak, next) => (!peak || next.percent > peak.percent ? next : peak),
    null,
  );

/**
 * The provider screen's lead card: who you are signed in as, the installed
 * runtime and its updates, service status, and a link to the plan's usage.
 *
 * Ported from `AccountContent`, which painted each provider in its own brand
 * palette (`bg-blue-50` / `border-purple-200` / `bg-gray-800` …). Those literals
 * are gone: the provider's identity is carried by its logo, and everything else
 * is theme tokens, per the restructure's no-hardcoded-colour rule.
 *
 * Codex's runtime row expands, because CLIde manages that binary and only
 * observes the others; a healthy transport still says nothing at all.
 */
export default function AgentAccountCard({
  provider,
  authStatus,
  onLogin,
  loginSucceeded = null,
  planUsage,
  onOpenUsage,
}: AgentAccountCardProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const status = toProviderStatus(authStatus);
  const providerName = t(`agents.providers.${provider}`);
  const versionPair = authStatus.versions ? formatVersionPair(authStatus.versions) : null;
  const codexTransport = useCodexTransport(provider === 'codex');
  const transportAlert = isTransportDegraded(codexTransport)
    ? t(`agents.codexTransport.alerts.${transportAlertKey(codexTransport)}`)
    : null;
  const capabilities = useProviderCapabilities();
  const serviceStatusPageUrl = capabilities?.[provider]?.serviceStatusPageUrl ?? null;
  const showUsage = authStatus.authenticated && planUsage?.supported === true;
  const peak = showUsage ? peakUsageWindow(planUsage) : null;

  return (
    <SettingsGroup divided>
        <div className="flex items-center gap-3 px-4 py-3">
          <SessionProviderLogo provider={provider} className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{providerName}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <SettingsStatus state={status.state} label={t(status.labelKey)} />
              {/* The server stands 'Authenticated' in for an unknown email; the status already says that. */}
              {authStatus.authenticated && authStatus.email && authStatus.email !== 'Authenticated' && (
                <span className="truncate">· {authStatus.email}</span>
              )}
            </div>
          </div>
          {authStatus.method !== 'api_key' && (
            <Button
              onClick={onLogin}
              size="sm"
              variant={authStatus.authenticated ? 'outline' : 'default'}
              className="h-8 flex-shrink-0"
            >
              <LogIn className="mr-1.5 h-3.5 w-3.5" />
              {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
            </Button>
          )}
        </div>

        {!authStatus.authenticated && (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {t('agents.login.description', { agent: providerName })}
          </div>
        )}

        {/*
          Codex's runtime is selectable, so its row expands in place instead of
          stating a pair; every other provider's is observed only.
        */}
        {provider === 'codex' && <AgentCodexRuntimeSection />}

        {provider === 'codex' && <AgentCliUpdateRow provider="codex" quietWhenCurrent />}

        {provider === 'claude' && (
          <AgentCliUpdateRow provider="claude" fallbackVersion={authStatus.versions?.runtime ?? null} />
        )}

        {provider === 'claude' && authStatus.versions?.sdk && (
          <AgentSdkReleaseRow installedVersion={authStatus.versions.sdk} />
        )}

        {/* Any other provider that starts reporting a version pair gets a plain row. */}
        {provider !== 'claude' && provider !== 'codex' && versionPair && (
          <SettingsRow label={t('agents.runtimeVersions.title')}>
            <span className="text-sm text-muted-foreground">{versionPair}</span>
          </SettingsRow>
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

        {serviceStatusPageUrl && (
          <AgentServiceStatusRow
            provider={provider}
            statusPageUrl={serviceStatusPageUrl}
          />
        )}

        {showUsage && (
          <SettingsNavRow
            label={t('agents.usage.title')}
            icon={Gauge}
            value={peak ? t('agents.usage.peak', {
              percent: peak.percent,
              window: formatUsageWindowLabel(peak.window, tCommon),
            }) : undefined}
            onClick={onOpenUsage}
          />
        )}
    </SettingsGroup>
  );
}
