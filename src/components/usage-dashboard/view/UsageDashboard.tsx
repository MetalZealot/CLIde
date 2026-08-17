import { AlertTriangle, ChevronDown, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { Button, Shimmer } from '../../../shared/view/ui';
import type { LLMProvider } from '../../../types/app';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import { CLI_PROVIDERS } from '../../provider-auth/types';
import type { ProviderAuthStatus } from '../../provider-auth/types';
import { useProviderAuthStatus } from '../../provider-auth/hooks/useProviderAuthStatus';
import UsageWindowList, {
  UsageActivitySection,
  UsageResetCreditsRow,
} from '../../provider-usage/UsageWindowList';
import {
  formatResetLocal,
  formatResetsIn,
  formatUpdatedAgo,
  formatUsageWindowLabel,
  usageBarToneClass,
} from '../../provider-usage/format';
import { useProviderUsage } from '../../provider-usage/hooks/useProviderUsage';
import type {
  ProviderUsageCredits,
  ProviderUsageStatus,
  ProviderUsageWindow,
} from '../../provider-usage/types';
import MobileMenuButton from '../../main-content/view/subcomponents/MobileMenuButton';

type UsageDashboardProps = {
  isMobile: boolean;
  onMenuClick: () => void;
};

type ProviderUsageCardProps = {
  provider: LLMProvider;
  authStatus: ProviderAuthStatus;
  refreshSignal: number;
};

const PRIMARY_WINDOW_IDS = new Set(['five_hour', 'seven_day']);

const formatCredits = (credits: ProviderUsageCredits): string => {
  if (credits.kind === 'balance') {
    if (credits.unlimited) return 'Unlimited';
    return credits.balance ?? (credits.hasCredits ? 'Available' : 'None');
  }

  const remaining = Math.max(0, credits.limitAmount - credits.usedAmount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: credits.currency,
    }).format(remaining);
  } catch {
    return `${remaining.toFixed(2)} ${credits.currency}`;
  }
};

function UsageMetric({ window }: { window: ProviderUsageWindow }) {
  const { t } = useTranslation('common');
  const utilization = Math.max(0, Math.min(100, window.utilization));
  const remaining = 100 - utilization;
  const resetsIn = formatResetsIn(window.resetsAt);
  const exactReset = formatResetLocal(window.resetsAt);
  const label = formatUsageWindowLabel(window, t);
  const remainingLabel = t('usageDashboard.percentRemaining', {
    defaultValue: '{{percent}}% remaining',
    percent: Math.round(remaining),
  });

  return (
    <div className="min-w-0 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {remainingLabel}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(utilization)}
          aria-valuetext={remainingLabel}
          className={cn('h-full rounded-full transition-[width]', usageBarToneClass(utilization))}
          style={{ width: `${utilization}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {resetsIn && (
          <span>{t('planUsage.resetsIn', { defaultValue: 'Resets in {{time}}', time: resetsIn })}</span>
        )}
        {resetsIn && exactReset && <span> · </span>}
        {exactReset && <span>{exactReset}</span>}
      </div>
    </div>
  );
}

function CreditMetric({ credits }: { credits: ProviderUsageCredits }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          {t('usageDashboard.creditBalance', { defaultValue: 'Credit balance' })}
        </div>
        {credits.kind === 'spend' && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('usageDashboard.afterPlanLimits', { defaultValue: 'Available after plan limits' })}
          </div>
        )}
      </div>
      <div className="shrink-0 font-mono text-sm font-semibold text-foreground">
        {formatCredits(credits)}
      </div>
    </div>
  );
}

function ProviderUsageCard({ provider, authStatus, refreshSignal }: ProviderUsageCardProps) {
  const { t } = useTranslation(['common', 'settings']);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const initialRefreshSignal = useRef(refreshSignal);
  const { usage, loading, error, refresh } = useProviderUsage(provider, { enabled: true });

  useEffect(() => {
    if (refreshSignal !== initialRefreshSignal.current) {
      refresh();
    }
  }, [refresh, refreshSignal]);

  const windows = useMemo(() => usage?.windows ?? [], [usage?.windows]);
  const primaryWindows = useMemo(() => {
    const core = windows.filter((window) => (
      PRIMARY_WINDOW_IDS.has(window.id)
      || window.durationMinutes === 300
      || (window.durationMinutes === 10_080 && !window.label)
    ));
    return (core.length > 0 ? core : windows).slice(0, 2);
  }, [windows]);
  const primaryIds = new Set(primaryWindows.map((window) => window.id));
  const detailWindows = windows.filter((window) => !primaryIds.has(window.id));
  const detailCredits = usage?.credits?.kind === 'spend' ? usage.credits : undefined;
  const hasDetails = Boolean(
    detailWindows.length || detailCredits,
  );
  const detailUsage: ProviderUsageStatus | null = usage ? {
    ...usage,
    windows: detailWindows,
    credits: detailCredits,
    resetCredits: undefined,
    activity: undefined,
    stale: false,
    error: undefined,
  } : null;
  const providerName = t(`settings:agents.providers.${provider}`);
  const identity = authStatus.email
    ?? (authStatus.method === 'api_key'
      ? t('usageDashboard.apiKeyConnected', { defaultValue: 'Connected with API key' })
      : t('usageDashboard.connected', { defaultValue: 'Connected' }));
  const updatedAgo = usage?.fetchedAt ? formatUpdatedAgo(usage.fetchedAt) : null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <SessionProviderLogo provider={provider} className="h-8 w-8 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{providerName}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {identity}
            {updatedAgo && (
              <> · {t('usageDashboard.updated', { defaultValue: 'Updated {{time}}', time: updatedAgo })}</>
            )}
          </p>
        </div>
      </div>

      {usage?.stale && (
        <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning sm:px-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div>{t('usageDashboard.stale', { defaultValue: 'Showing the last successful usage update.' })}</div>
            {usage.error && <div className="mt-0.5 text-xs opacity-80">{usage.error}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            {t('buttons.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      )}

      <div className="px-4 sm:px-5">
        {loading && !usage && (
          <div className="space-y-3 py-4">
            <Shimmer className="text-sm">{t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}</Shimmer>
          </div>
        )}

        {!loading && usage?.supported === false && (
          <p className="py-4 text-sm text-muted-foreground">
            {usage.reason === 'api_key'
              ? t('usageDashboard.apiKeyUnavailable', {
                defaultValue: 'This provider does not expose account usage for API-key connections.',
              })
              : t('usageDashboard.unavailable', {
                defaultValue: 'This provider does not expose account usage to CLIde.',
              })}
          </p>
        )}

        {!loading && !usage && error && (
          <div className="flex items-center justify-between gap-3 py-4 text-sm text-destructive">
            <span>{t('usageDashboard.loadFailed', { defaultValue: "Couldn't load provider usage." })}</span>
            <Button variant="outline" size="sm" onClick={refresh}>
              {t('buttons.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        )}

        {usage?.supported && (
          <>
            {primaryWindows.length > 0 || usage.credits ? (
              <div className="divide-y divide-border/60">
                {primaryWindows.map((window) => <UsageMetric key={window.id} window={window} />)}
                {usage.credits && <CreditMetric credits={usage.credits} />}
                {usage.resetCredits && (
                  <UsageResetCreditsRow resetCredits={usage.resetCredits} showDivider={false} />
                )}
                {usage.activity && (
                  <div className="py-4">
                    <UsageActivitySection
                      activity={usage.activity}
                      showDivider={false}
                      collapsible
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                {usage.error ?? t('planUsage.noData', { defaultValue: 'No plan usage reported.' })}
              </p>
            )}

            {hasDetails && (
              <div className="border-t border-border/60">
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen((open) => !open)}
                  className="flex min-h-12 w-full items-center justify-between text-sm font-medium text-foreground transition-colors hover:text-primary active:text-primary"
                >
                  <span>{t('usageDashboard.details', { defaultValue: 'Details' })}</span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', detailsOpen && 'rotate-180')} />
                </button>
                {detailsOpen && detailUsage && (
                  <div className="border-t border-border/60 pb-4 pt-4">
                    <UsageWindowList usage={detailUsage} loading={false} error={null} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function UsageDashboard({ isMobile, onMenuClick }: UsageDashboardProps) {
  const { t } = useTranslation('common');
  const { providerAuthStatus, refreshProviderAuthStatuses } = useProviderAuthStatus();
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    void refreshProviderAuthStatuses();
  }, [refreshProviderAuthStatuses]);

  const loadingAuth = CLI_PROVIDERS.some((provider) => providerAuthStatus[provider].loading);
  const connectedProviders = CLI_PROVIDERS.filter(
    (provider) => providerAuthStatus[provider].authenticated,
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {isMobile && (
        <div className="app-bar border-b border-border/50 bg-background/80 px-3 sm:px-4">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:p-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {t('usageDashboard.title', { defaultValue: 'Usage' })}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('usageDashboard.description', {
                  defaultValue: 'Account-level limits and balances for connected model providers.',
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingAuth || connectedProviders.length === 0}
              onClick={() => setRefreshSignal((signal) => signal + 1)}
              aria-label={t('buttons.refresh', { defaultValue: 'Refresh' })}
            >
              <RefreshCw className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">
                {t('buttons.refresh', { defaultValue: 'Refresh' })}
              </span>
            </Button>
          </header>

          {loadingAuth && connectedProviders.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/50 p-5">
              <Shimmer className="text-sm">
                {t('usageDashboard.loadingProviders', { defaultValue: 'Checking connected providers…' })}
              </Shimmer>
            </div>
          ) : connectedProviders.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/50 p-5 text-sm text-muted-foreground">
              {t('usageDashboard.noProviders', { defaultValue: 'No model providers are connected.' })}
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {connectedProviders.map((provider) => (
                <ProviderUsageCard
                  key={provider}
                  provider={provider}
                  authStatus={providerAuthStatus[provider]}
                  refreshSignal={refreshSignal}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
