import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityIcon, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import { useProviderUsage } from '../../../provider-usage/hooks/useProviderUsage';
import { UsageActivitySection } from '../../../provider-usage/UsageWindowList';
import type {
  ProviderUsageBalanceCredits,
  ProviderUsageCredits,
  ProviderUsageSpendCredits,
  ProviderUsageWindow,
} from '../../../provider-usage/types';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import type {
  ContextCommandData,
  UsagePopoverRequest,
  UsagePopoverView,
} from '../../hooks/useChatComposerState';

import { ComposerMenuSurface } from './ComposerMenuPrimitives';
import ContextBreakdownView from './ContextBreakdownView';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  request: UsagePopoverRequest;
  onRequestBreakdown: () => void;
  onRefreshBreakdown: () => void;
  isRefreshingBreakdown: boolean;
  canRefreshBreakdown: boolean;
  provider?: string;
};

// A fresh session has no `token_budget` frame yet, so `usage` is null until the
// first turn. For providers with a known context window we still want the ring
// to render (empty, at 0%) from the start instead of the legacy activity icon.
// Providers that never report a window (cursor/opencode) fall through to null
// and keep the icon fallback. Claude's placeholder matches what the server
// derives for an unknown model; once the first real frame arrives its `total`
// takes over, and that value now comes from the SDK itself.
const PROVIDER_DEFAULT_CONTEXT_WINDOW: Record<string, number> = {
  claude: 200_000,
  codex: 200_000,
};

const PROVIDER_USAGE_MANAGEMENT_URLS: Partial<Record<LLMProvider, string>> = {
  claude: 'https://claude.ai/new#settings/usage',
  codex: 'https://chatgpt.com/#settings/Usage',
};

const KNOWN_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly (Opus)',
  seven_day_sonnet: 'Weekly (Sonnet)',
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toUsageProvider = (provider: string | undefined): LLMProvider | null => (
  provider === 'claude' || provider === 'cursor' || provider === 'codex' || provider === 'opencode'
    ? provider
    : null
);

const formatWindowLabel = (window: ProviderUsageWindow): string => {
  const durationLabel = window.durationMinutes === 300
    ? '5-hour limit'
    : window.durationMinutes === 10_080
      ? 'Weekly'
      : window.durationMinutes
        ? `${window.durationMinutes % 1440 === 0
          ? `${window.durationMinutes / 1440}-day`
          : window.durationMinutes % 60 === 0
            ? `${window.durationMinutes / 60}-hour`
            : `${window.durationMinutes}-minute`} limit`
        : null;
  const baseLabel = KNOWN_WINDOW_LABELS[window.id]
    ?? durationLabel
    ?? window.id.replace(/[:_]/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
  return window.label ? `${window.label} · ${baseLabel}` : baseLabel;
};

const formatResetAt = (window: ProviderUsageWindow): string | null => {
  if (!window.resetsAt) return null;

  const date = new Date(window.resetsAt);
  if (Number.isNaN(date.getTime())) return null;

  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const isWeekly = window.durationMinutes === 10_080 || window.id.startsWith('seven_day');
  if (!isWeekly) return `Resets at ${time}`;

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return `Resets ${weekday} ${time}`;
};

const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const formatSpendCredits = (credits: ProviderUsageSpendCredits): string => (
  formatMoney(credits.usedAmount, credits.currency)
);

const formatBalanceCredits = (credits: ProviderUsageBalanceCredits): string => {
  if (credits.unlimited) return 'Unlimited';
  if (credits.balance) return credits.balance;
  return credits.hasCredits ? 'Available' : 'None';
};

const formatCreditValue = (credits: ProviderUsageCredits): string => (
  credits.kind === 'spend' ? formatSpendCredits(credits) : formatBalanceCredits(credits)
);

const creditsAreAvailable = (credits: ProviderUsageCredits | undefined): boolean => {
  if (!credits) return false;
  if (credits.kind === 'spend') {
    return credits.enabled && credits.usedAmount < credits.limitAmount;
  }
  return credits.unlimited || Boolean(
    credits.hasCredits
    && !credits.limitReachedReason?.includes('depleted')
    && !credits.limitReachedReason?.includes('usage_limit_reached'),
  );
};

const usageWindowOrder = (window: ProviderUsageWindow): number => {
  if (window.id === 'five_hour' || window.durationMinutes === 300) return 0;
  if (window.id === 'seven_day' || window.durationMinutes === 10_080) return 1;
  return 2;
};

// The wheel fills and colours against the same number: the point where the
// session stops being able to grow. That is `autoCompactThreshold` when
// auto-compact is on (Claude reports e.g. a 967k window that compacts at 934k —
// the last 33k is never usable conversation), and the window itself otherwise.
// Filling against the window instead left the wheel looking calm at the exact
// moment a compact fired. Green/amber/red is the signal; the count is detail.
const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const toneFor = (fraction: number) => {
  if (fraction >= 0.9) return 'text-red-500';
  if (fraction >= 0.75) return 'text-amber-500';
  return 'text-emerald-500';
};

const barToneFor = (fraction: number) => {
  if (fraction >= 0.9) return 'bg-red-500';
  if (fraction >= 0.75) return 'bg-amber-500';
  return 'bg-emerald-500';
};

function UsageWheel({
  fraction,
  tone,
  showCreditMarker,
}: {
  fraction: number;
  tone: string;
  showCreditMarker: boolean;
}) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <span className="relative grid h-5 w-5 place-items-center">
      <svg viewBox="0 0 20 20" className={cn('h-5 w-5 -rotate-90', tone)} aria-hidden>
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          className="stroke-current opacity-20"
        />
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-current transition-[stroke-dashoffset] duration-500"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      {showCreditMarker && (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center text-[8px] font-bold leading-none text-amber-500"
          aria-hidden
        >
          $
        </span>
      )}
    </span>
  );
}

function UsageBar({ utilization }: { utilization: number }) {
  const clamped = Math.min(100, Math.max(0, utilization));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full transition-[width]', barToneFor(clamped / 100))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function PlanWindowRow({
  window,
  onViewUsage,
}: {
  window: ProviderUsageWindow;
  onViewUsage?: () => void;
}) {
  const resetLabel = formatResetAt(window);
  const utilization = Math.min(100, Math.max(0, window.utilization));

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-foreground">{formatWindowLabel(window)}</span>
        <span className="shrink-0 text-muted-foreground">{Math.round(utilization)}% used</span>
      </div>
      <UsageBar utilization={utilization} />
      {(resetLabel || onViewUsage) && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{resetLabel}</span>
          {onViewUsage && (
            <button
              type="button"
              onClick={onViewUsage}
              className="inline-flex shrink-0 items-center transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Usage
              <ChevronRight className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function TokenUsageSummary({
  usage,
  request,
  onRequestBreakdown,
  onRefreshBreakdown,
  isRefreshingBreakdown,
  canRefreshBreakdown,
  provider,
}: TokenUsageSummaryProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<UsagePopoverView>('summary');
  const [contextData, setContextData] = useState<ContextCommandData | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const handledRequestId = useRef(0);
  const popoverId = useId();
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 19 * 16);
  const usageProvider = toUsageProvider(provider);
  const planUsage = useProviderUsage(usageProvider);
  const refreshPlanUsageIfStale = planUsage.refreshIfStale;

  useEffect(() => {
    if (request.id <= handledRequestId.current) return;

    handledRequestId.current = request.id;
    setView(request.view);
    if (request.view === 'breakdown') {
      setContextData(request.context ?? null);
      setBreakdownLoading(request.context === undefined);
    } else {
      setBreakdownLoading(false);
    }
    updateAnchor();
    setIsOpen(true);
    refreshPlanUsageIfStale();
  }, [request, updateAnchor, refreshPlanUsageIfStale]);
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const reportedWindow = readUsageNumber(usage?.total);
  const contextWindow =
    reportedWindow > 0
      ? reportedWindow
      : (provider ? PROVIDER_DEFAULT_CONTEXT_WINDOW[provider] ?? 0 : 0);
  const autoCompactThreshold = readUsageNumber(usage?.autoCompactThreshold);
  const compactsAutomatically = usage?.isAutoCompactEnabled === true && autoCompactThreshold > 0;

  // The ceiling that actually matters is where auto-compact fires, not the raw
  // window: at that point the conversation is summarised out from under the
  // user, so the tokens above it were never theirs to spend. Claude Code counts
  // the same way — its /context "Free space" is measured to the threshold, with
  // the remainder carved out as an "Autocompact buffer" slice. With auto-compact
  // off (or a provider that reports no threshold) the window IS the cliff, so it
  // stands as the ceiling.
  const effectiveCeiling = compactsAutomatically ? autoCompactThreshold : contextWindow;
  const fraction = effectiveCeiling > 0 ? usedTokens / effectiveCeiling : null;
  const utilization = fraction === null ? null : Math.min(Math.max(fraction, 0), 1);
  const percentUsed = utilization === null ? null : Math.round(utilization * 100);
  const providerUsage = planUsage.usage?.supported === true ? planUsage.usage : null;
  const planWindows = [...(providerUsage?.windows ?? [])].sort(
    (left, right) => usageWindowOrder(left) - usageWindowOrder(right),
  );
  const activityWindowId = providerUsage?.activity
    ? planWindows.find((window) => (
        window.id.startsWith('seven_day') || window.durationMinutes === 10_080
      ))?.id
    : undefined;
  const creditMarkerVisible = creditsAreAvailable(providerUsage?.credits);
  const managementUrl = usageProvider ? PROVIDER_USAGE_MANAGEMENT_URLS[usageProvider] : undefined;
  const autoCompactStatus = provider === 'claude'
    && usage?.isAutoCompactEnabled === true
    && autoCompactThreshold > 0
    ? ' · Auto'
    : provider === 'claude' && usage?.isAutoCompactEnabled === false
      ? ' · Auto off'
      : '';

  const title =
    fraction === null
      ? `${usedTokens.toLocaleString()} tokens used`
      : compactsAutomatically
        ? `${usedTokens.toLocaleString()} / ${autoCompactThreshold.toLocaleString()} tokens before auto-compact (${Math.round(
            Math.min(fraction, 1) * 100,
          )}%)\nAuto-compact rewrites the conversation here. Window: ${contextWindow.toLocaleString()}.`
        : `${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${Math.round(
            Math.min(fraction, 1) * 100,
          )}% of context window)`;
  const accessibleTitle = creditMarkerVisible ? `${title}\nUsage credits available.` : title;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            close();
            return;
          }

          setView('summary');
          updateAnchor();
          setIsOpen(true);
          refreshPlanUsageIfStale();
        }}
        className="inline-flex h-8 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        title={accessibleTitle}
        aria-label={creditMarkerVisible ? 'Show usage; credits available' : 'Show usage'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
      >
        {fraction === null ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
            <ActivityIcon className="h-3.5 w-3.5" />
          </span>
        ) : (
          <UsageWheel
            fraction={fraction}
            tone={toneFor(Math.min(Math.max(fraction, 0), 1))}
            showCreditMarker={creditMarkerVisible}
          />
        )}
        <span className="hidden font-medium text-foreground md:inline">{formatTokenCount(usedTokens)}</span>
      </button>
      {isOpen && anchor && createPortal(
        <ComposerMenuSurface
          id={popoverId}
          anchor={anchor}
          menuRef={menuRef}
          role="dialog"
          fillAnchorWidth
          className="px-4 py-3"
          ariaLabel={view === 'summary'
            ? 'Session and plan usage'
            : view === 'breakdown'
              ? 'Session breakdown'
              : 'Usage activity'}
        >
          <div className="mb-3 text-[11px] font-medium text-muted-foreground">
            Context &amp; Usage
          </div>
          {view === 'summary' && (
            <div className="space-y-4">
              <section className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">Session</span>
                  <span className="shrink-0 text-muted-foreground">
                    {percentUsed === null ? '—' : `${percentUsed}% used`}
                  </span>
                </div>
                {percentUsed !== null && <UsageBar utilization={percentUsed} />}
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {effectiveCeiling > 0
                      ? `${usedTokens.toLocaleString()} / ${effectiveCeiling.toLocaleString()}${autoCompactStatus}`
                      : `${usedTokens.toLocaleString()} tokens`}
                  </span>
                  {provider === 'claude' && (
                    <button
                      type="button"
                      onClick={() => {
                        setContextData(null);
                        setBreakdownLoading(true);
                        setView('breakdown');
                        onRequestBreakdown();
                      }}
                      className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Breakdown
                      <ChevronRight className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </div>
              </section>

              {planWindows.map((window) => {
                return (
                  <PlanWindowRow
                    key={window.id}
                    window={window}
                    onViewUsage={window.id === activityWindowId
                      ? () => setView('activity')
                      : undefined}
                  />
                );
              })}

              {providerUsage?.credits && (
                <section className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-foreground">Credits/Tokens</span>
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={providerUsage.credits.kind === 'spend' ? 'Usage-credit spend this period' : 'Credit balance'}
                    >
                      {formatCreditValue(providerUsage.credits)}
                    </span>
                  </div>
                </section>
              )}

              {providerUsage?.stale && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('planUsage.stale', {
                    defaultValue: 'Showing cached data — the last refresh failed.',
                  })}
                </p>
              )}

              {!providerUsage && planUsage.loading && (
                <p className="text-xs text-muted-foreground">
                  {t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}
                </p>
              )}

              {!providerUsage && !planUsage.loading && planUsage.error && (
                <p className="text-xs text-muted-foreground">
                  {t('planUsage.loadError', { defaultValue: "Couldn't load plan usage." })}
                </p>
              )}

              {managementUrl && (
                <a
                  href={managementUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Manage Plan and Balance
                </a>
              )}
            </div>
          )}

          {view === 'breakdown' && (
            <ContextBreakdownView
              data={contextData}
              loading={breakdownLoading}
              onBack={() => setView('summary')}
              onRefresh={onRefreshBreakdown}
              isRefreshing={isRefreshingBreakdown}
              canRefresh={canRefreshBreakdown}
            />
          )}

          {view === 'activity' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setView('summary')}
                className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Usage activity
              </button>
              {providerUsage?.activity ? (
                <UsageActivitySection
                  activity={providerUsage.activity}
                  showDivider={false}
                  showHeading={false}
                />
              ) : planUsage.loading ? (
                <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}
                </p>
              ) : (
                <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  No usage activity is reported for this account.
                </p>
              )}
            </div>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
