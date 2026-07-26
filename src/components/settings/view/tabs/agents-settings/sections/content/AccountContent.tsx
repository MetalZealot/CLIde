import { LogIn, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../../../utils/api';
import SessionProviderLogo from '../../../../../../llm-logo-provider/SessionProviderLogo';
import UsageWindowList from '../../../../../../provider-usage/UsageWindowList';
import { useProviderUsage } from '../../../../../../provider-usage/hooks/useProviderUsage';
import type { AgentProvider, AuthStatus } from '../../../../../types/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: AuthStatus;
  onLogin: () => void;
};

type AgentVisualConfig = {
  name: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subtextClass: string;
  buttonClass: string;
  description?: string;
};

type CodexTransportDiagnostics = {
  configured: 'app-server' | 'sdk';
  actual: 'app-server' | 'sdk';
  health: 'disabled' | 'idle' | 'starting' | 'ready' | 'stopped' | 'fallback';
  bundledCliVersion: string | null;
  lastError: string | null;
  lastStartupFallbackAt: string | null;
};

type CodexCapabilitiesResponse = {
  success?: boolean;
  data?: {
    chatTransport?: CodexTransportDiagnostics;
  };
};

const transportLabel = (transport: 'app-server' | 'sdk'): string =>
  transport === 'app-server' ? 'App Server' : 'TypeScript SDK';

const agentConfig: Record<AgentProvider, AgentVisualConfig> = {
  claude: {
    name: 'Claude',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
  },
  cursor: {
    name: 'Cursor',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-900 dark:text-purple-100',
    subtextClass: 'text-purple-700 dark:text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800',
  },
  codex: {
    name: 'Codex',
    bgClass: 'bg-muted/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 active:bg-gray-950 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-500',
  },
  opencode: {
    name: 'OpenCode',
    description: 'OpenCode CLI assistant',
    bgClass: 'bg-zinc-50 dark:bg-zinc-900/20',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    textClass: 'text-zinc-900 dark:text-zinc-100',
    subtextClass: 'text-zinc-700 dark:text-zinc-300',
    buttonClass: 'bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-700 dark:hover:bg-zinc-600',
  },
};

const formatUpdatedAgo = (fetchedAt: string): string | null => {
  const elapsedMs = Date.now() - Date.parse(fetchedAt);
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return null;
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  return minutes < 1 ? 'just now' : `${minutes}m ago`;
};

export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];
  const usageProvider = agent;
  const planUsage = useProviderUsage(usageProvider, {
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
  const [codexTransport, setCodexTransport] = useState<CodexTransportDiagnostics | null>(null);

  useEffect(() => {
    if (agent !== 'codex') {
      setCodexTransport(null);
      return;
    }

    let cancelled = false;
    void authenticatedFetch('/api/providers/codex/capabilities')
      .then(async (response) => {
        const body = (await response.json()) as CodexCapabilitiesResponse;
        if (!cancelled && body.success && body.data?.chatTransport) {
          setCodexTransport(body.data.chatTransport);
        }
      })
      .catch((error) => {
        console.error('Error loading Codex transport diagnostics:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [agent]);

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-3">
        <SessionProviderLogo provider={agent} className="h-6 w-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agents.account.${agent}.description`, {
              defaultValue: config.description || `${config.name} CLI assistant`,
            })}
          </p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : authStatus.authenticated ? (
                  t('agents.authStatus.loggedInAs', {
                    email: authStatus.email || t('agents.authStatus.authenticatedUser'),
                  })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus.loading ? (
                <Badge variant="secondary" className="bg-muted">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : authStatus.authenticated ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          {agent === 'codex' && codexTransport && (
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={`font-medium ${config.textClass}`}>
                    {t('agents.codexTransport.title', { defaultValue: 'Chat transport' })}
                  </div>
                  <div className={`text-sm ${config.subtextClass}`}>
                    {t('agents.codexTransport.detail', {
                      defaultValue: 'Configured: {{configured}} · Status: {{health}}{{version}}',
                      configured: transportLabel(codexTransport.configured),
                      health: codexTransport.health,
                      version: codexTransport.bundledCliVersion
                        ? ` · CLI ${codexTransport.bundledCliVersion}`
                        : '',
                    })}
                  </div>
                  {codexTransport.lastError && (
                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {codexTransport.lastError}
                    </div>
                  )}
                </div>
                <Badge
                  variant="secondary"
                  className={
                    codexTransport.health === 'fallback' || codexTransport.health === 'stopped'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  }
                >
                  {transportLabel(codexTransport.actual)}
                </Badge>
              </div>
            </div>
          )}

          {authStatus.method !== 'api_key' && (
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`font-medium ${config.textClass}`}>
                    {authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                  </div>
                  <div className={`text-sm ${config.subtextClass}`}>
                    {authStatus.authenticated
                      ? t('agents.login.reAuthDescription')
                      : t('agents.login.description', { agent: config.name })}
                  </div>
                </div>
                <Button
                  onClick={onLogin}
                  className={`${config.buttonClass} text-white`}
                  size="sm"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                </Button>
              </div>
            </div>
          )}

          {authStatus.error && (
            <div className="border-t border-border/50 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showUsageCard && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-foreground">
                {t('agents.usage.title', { defaultValue: 'Plan Usage' })}
              </div>
              {usageUpdatedAgo && (
                <div className="text-xs text-muted-foreground">
                  {t('agents.usage.updatedAgo', {
                    defaultValue: 'Updated {{time}}',
                    time: usageUpdatedAgo,
                  })}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={planUsage.refresh}
              disabled={planUsage.loading}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('agents.usage.refresh', { defaultValue: 'Refresh plan usage' })}
            >
              <RefreshCw className={planUsage.loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              {t('agents.usage.refreshButton', { defaultValue: 'Refresh' })}
            </Button>
          </div>
          <UsageWindowList usage={planUsage.usage} loading={planUsage.loading} error={planUsage.error} />
        </div>
      )}

      {showApiKeyUsageNote && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-sm text-muted-foreground">
            {t('agents.usage.apiKeyUnavailable', {
              defaultValue: 'Plan usage is only available for subscription sign-in, not API-key auth.',
            })}
          </div>
        </div>
      )}
    </div>
  );
}
