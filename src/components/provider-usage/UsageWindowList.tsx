import { ChevronDown } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../shared/view/ui';
import { cn } from '../../lib/utils';

import type {
  ProviderUsageActivity,
  ProviderUsageBalanceCredits,
  ProviderUsageCredits,
  ProviderUsageResetCredits,
  ProviderUsageSpendCredits,
  ProviderUsageStatus,
  ProviderUsageWindow,
} from './types';

type UsageWindowListProps = {
  usage: ProviderUsageStatus | null;
  loading: boolean;
  error: string | null;
  /**
   * Render only the rate-limit windows (the 5-hour/weekly bars), dropping
   * credits, reset credits, and account activity. The context panel embeds the
   * limits as a footer under the context breakdown, where the rest of the
   * account picture would bury what the panel is actually about; the full view
   * still lives in `/usage` and Settings.
   */
  windowsOnly?: boolean;
};

const KNOWN_WINDOW_LABELS: Record<string, { key: string; defaultValue: string }> = {
  five_hour: { key: 'planUsage.fiveHour', defaultValue: '5-hour limit' },
  seven_day: { key: 'planUsage.weekly', defaultValue: 'Weekly limit' },
  seven_day_opus: { key: 'planUsage.weeklyOpus', defaultValue: 'Weekly limit (Opus)' },
  seven_day_sonnet: { key: 'planUsage.weeklySonnet', defaultValue: 'Weekly limit (Sonnet)' },
};

const prettifyWindowId = (id: string): string => (
  id.replace(/[:_]/g, ' ').replace(/^\w/, (char) => char.toUpperCase())
);

const barToneClass = (utilization: number): string => {
  if (utilization >= 90) {
    return 'bg-red-500';
  }
  if (utilization >= 75) {
    return 'bg-amber-500';
  }
  return 'bg-emerald-500';
};

export const formatResetsIn = (resetsAt: string | null): string | null => {
  if (!resetsAt) {
    return null;
  }

  const remainingMs = Date.parse(resetsAt) - Date.now();
  if (Number.isNaN(remainingMs) || remainingMs <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

function UsageWindowRow({ window }: { window: ProviderUsageWindow }) {
  const { t } = useTranslation('common');
  const knownLabel = KNOWN_WINDOW_LABELS[window.id];
  const durationLabel = window.durationMinutes === 300
    ? t('planUsage.fiveHour', { defaultValue: '5-hour limit' })
    : window.durationMinutes === 10_080
      ? t('planUsage.weekly', { defaultValue: 'Weekly limit' })
      : window.durationMinutes
        ? `${window.durationMinutes % 1440 === 0
          ? `${window.durationMinutes / 1440}-day`
          : window.durationMinutes % 60 === 0
            ? `${window.durationMinutes / 60}-hour`
            : `${window.durationMinutes}-minute`} limit`
        : null;
  const baseLabel = knownLabel
    ? t(knownLabel.key, { defaultValue: knownLabel.defaultValue })
    : durationLabel ?? prettifyWindowId(window.id);
  const displayLabel = window.label ? `${window.label} · ${baseLabel}` : baseLabel;
  const resetsIn = formatResetsIn(window.resetsAt);
  const clamped = Math.min(100, Math.max(0, window.utilization));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {displayLabel}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {t('planUsage.percentUsed', {
            defaultValue: '{{percent}}% used',
            percent: Math.round(clamped),
          })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', barToneClass(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {resetsIn && (
        <p className="text-xs text-muted-foreground">
          {t('planUsage.resetsIn', { defaultValue: 'Resets in {{time}}', time: resetsIn })}
        </p>
      )}
    </div>
  );
}

const formatCredits = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/**
 * Renders paid usage-credit spend (the amount covering you once plan windows
 * are exhausted): a bar of used/limit plus a "Learn more" link when the
 * provider supplies one. Shown below the rate-limit windows.
 */
function UsageSpendCreditsRow({ credits }: { credits: ProviderUsageSpendCredits }) {
  const { t } = useTranslation('common');
  const clamped = Math.min(100, Math.max(0, credits.utilization));

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {t('planUsage.credits', { defaultValue: 'Usage credits' })}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {t('planUsage.percentUsed', {
            defaultValue: '{{percent}}% used',
            percent: Math.round(clamped),
          })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', barToneClass(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('planUsage.creditsUsed', {
            defaultValue: '{{used}} of {{limit}} used',
            used: formatCredits(credits.usedAmount, credits.currency),
            limit: formatCredits(credits.limitAmount, credits.currency),
          })}
        </p>
        {credits.learnMoreUrl && (
          <a
            href={credits.learnMoreUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {t('planUsage.creditsLearnMore', { defaultValue: 'Learn more' })}
          </a>
        )}
      </div>
      {!credits.enabled && (
        <p className="text-xs text-muted-foreground">
          {t('planUsage.creditsOff', {
            defaultValue: 'Credits are off — usage stops at your plan limit.',
          })}
        </p>
      )}
    </div>
  );
}

const REACHED_REASON_COPY: Record<string, string> = {
  rate_limit_reached: 'Plan limit reached.',
  workspace_owner_credits_depleted: 'Workspace credits are depleted.',
  workspace_member_credits_depleted: 'Workspace credits are depleted.',
  workspace_owner_usage_limit_reached: 'Workspace usage limit reached.',
  workspace_member_usage_limit_reached: 'Workspace usage limit reached.',
};

function UsageBalanceCreditsRow({ credits }: { credits: ProviderUsageBalanceCredits }) {
  const { t } = useTranslation('common');
  const individualLimit = credits.individualLimit;
  const individualUtilization = individualLimit
    ? 100 - Math.min(100, Math.max(0, individualLimit.remainingPercent))
    : null;
  const resetsIn = individualLimit ? formatResetsIn(individualLimit.resetsAt) : null;
  const balanceValue = credits.unlimited
    ? t('planUsage.unlimited', { defaultValue: 'Unlimited' })
    : credits.balance
      ?? (credits.hasCredits
        ? t('planUsage.available', { defaultValue: 'Available' })
        : t('planUsage.none', { defaultValue: 'None' }));

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {t('planUsage.creditBalance', { defaultValue: 'Credit balance' })}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {balanceValue}
        </span>
      </div>

      {individualLimit && individualUtilization !== null && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t('planUsage.individualLimit', { defaultValue: 'Individual limit' })}
            </span>
            <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
              {t('planUsage.percentUsed', {
                defaultValue: '{{percent}}% used',
                percent: Math.round(individualUtilization),
              })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-[width]', barToneClass(individualUtilization))}
              style={{ width: `${individualUtilization}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {t('planUsage.creditsUsed', {
                defaultValue: '{{used}} of {{limit}} used',
                used: individualLimit.used,
                limit: individualLimit.limit,
              })}
            </span>
            {resetsIn && (
              <span>
                {t('planUsage.resetsIn', { defaultValue: 'Resets in {{time}}', time: resetsIn })}
              </span>
            )}
          </div>
        </div>
      )}

      {credits.limitReachedReason && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {REACHED_REASON_COPY[credits.limitReachedReason]
            ?? prettifyWindowId(credits.limitReachedReason)}
        </p>
      )}
    </div>
  );
}

function UsageCreditsRow({ credits }: { credits: ProviderUsageCredits }) {
  return credits.kind === 'spend'
    ? <UsageSpendCreditsRow credits={credits} />
    : <UsageBalanceCreditsRow credits={credits} />;
}

function UsageResetCreditsRow({ resetCredits }: { resetCredits: ProviderUsageResetCredits }) {
  const { t } = useTranslation('common');
  const availability = resetCredits.availableCount === 1
    ? t('planUsage.oneResetAvailable', { defaultValue: '1 available' })
    : t('planUsage.resetsAvailable', {
      defaultValue: '{{count}} available',
      count: resetCredits.availableCount,
    });

  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-4">
      <span className="text-sm font-medium text-foreground">
        {t('planUsage.usageLimitResets', { defaultValue: 'Usage limit resets' })}
      </span>
      <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
        {availability}
      </span>
    </div>
  );
}

const formatTokenCount = (tokens: number): string => (
  new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(tokens)
);

const formatTurnDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

export function UsageActivitySection({
  activity,
  showDivider = true,
  showHeading = true,
  collapsible = false,
}: {
  activity: ProviderUsageActivity;
  showDivider?: boolean;
  showHeading?: boolean;
  /**
   * Starts collapsed behind its heading. For Settings, where the stat grid and
   * the 14-day chart otherwise push every provider row below the fold.
   */
  collapsible?: boolean;
}) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const stats = [
    activity.lifetimeTokens === undefined ? null : {
      label: t('planUsage.lifetimeTokens', { defaultValue: 'Lifetime tokens' }),
      value: formatTokenCount(activity.lifetimeTokens),
    },
    activity.peakDailyTokens === undefined ? null : {
      label: t('planUsage.peakDailyTokens', { defaultValue: 'Peak day' }),
      value: formatTokenCount(activity.peakDailyTokens),
    },
    activity.longestRunningTurnSeconds === undefined ? null : {
      label: t('planUsage.longestTurn', { defaultValue: 'Longest turn' }),
      value: formatTurnDuration(activity.longestRunningTurnSeconds),
    },
    activity.currentStreakDays === undefined ? null : {
      label: t('planUsage.currentStreak', { defaultValue: 'Current streak' }),
      value: `${activity.currentStreakDays}d`,
    },
    activity.longestStreakDays === undefined ? null : {
      label: t('planUsage.longestStreak', { defaultValue: 'Best streak' }),
      value: `${activity.longestStreakDays}d`,
    },
  ].filter((stat): stat is { label: string; value: string } => stat !== null);
  const recentDaily = [...(activity.daily ?? [])]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-14);
  const maxDailyTokens = Math.max(1, ...recentDaily.map((bucket) => bucket.tokens));

  const collapsed = collapsible && showHeading && !expanded;
  const heading = t('planUsage.tokenActivity', { defaultValue: 'Token activity' });
  const subheading = t('planUsage.activityNotAllowance', {
    defaultValue: 'Account activity — separate from plan limits.',
  });

  return (
    <div className={cn('space-y-3', showDivider && 'border-t border-border/60 pt-4')}>
      {showHeading && !collapsible && (
        <div>
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="text-xs text-muted-foreground">{subheading}</p>
        </div>
      )}

      {/*
        Collapsed, this is one label/value line so it sits in the same two-column
        rhythm as the limit rows above it. The caveat only appears once opened,
        where there is something to caveat.
      */}
      {showHeading && collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex w-full touch-manipulation items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{heading}</span>
          {collapsed && activity.lifetimeTokens !== undefined && (
            <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
              {formatTokenCount(activity.lifetimeTokens)}
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      )}

      {showHeading && collapsible && expanded && (
        <p className="-mt-1 text-xs text-muted-foreground">{subheading}</p>
      )}

      {!collapsed && stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="font-mono text-sm font-semibold text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {!collapsed && recentDaily.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {t('planUsage.recentDailyActivity', { defaultValue: 'Recent daily activity' })}
          </p>
          <div className="flex h-12 items-end gap-1" aria-label={t('planUsage.recentDailyActivity', {
            defaultValue: 'Recent daily activity',
          })}>
            {recentDaily.map((bucket) => {
              const heightPercent = bucket.tokens === 0
                ? 4
                : Math.max(8, (bucket.tokens / maxDailyTokens) * 100);
              const label = `${bucket.date}: ${formatTokenCount(bucket.tokens)} ${t('planUsage.tokens', {
                defaultValue: 'tokens',
              })}`;

              return (
                <div
                  key={bucket.date}
                  className="min-w-0 flex-1 rounded-sm bg-primary/80"
                  style={{ height: `${heightPercent}%` }}
                  title={label}
                  aria-label={label}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{recentDaily[0].date}</span>
            <span>{recentDaily[recentDaily.length - 1].date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders provider usage surfaces: plan windows, credits/reset credits, and
 * optional account activity. Renders nothing when the provider/auth method has
 * no usage data; callers decide whether to show an explanatory note instead.
 */
export default function UsageWindowList({
  usage,
  loading,
  error,
  windowsOnly = false,
}: UsageWindowListProps) {
  const { t } = useTranslation('common');

  if (loading && !usage) {
    return (
      <div className="space-y-2">
        <Shimmer className="text-sm">{t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}</Shimmer>
      </div>
    );
  }

  if (!usage) {
    return error ? (
      <p className="text-sm text-red-600 dark:text-red-400">
        {t('planUsage.loadError', { defaultValue: "Couldn't load plan usage." })}
      </p>
    ) : null;
  }

  if (!usage.supported) {
    return null;
  }

  if (usage.reason === 'not_authenticated' || (!usage.windows && usage.error)) {
    return (
      <p className="text-sm text-muted-foreground">
        {usage.error || t('planUsage.loadError', { defaultValue: "Couldn't load plan usage." })}
      </p>
    );
  }

  const windows = usage.windows ?? [];
  const credits = windowsOnly ? null : usage.credits ?? null;
  const resetCredits = windowsOnly ? null : usage.resetCredits ?? null;
  const activity = windowsOnly ? null : usage.activity ?? null;
  if (windows.length === 0 && !credits && !resetCredits && !activity) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('planUsage.noData', { defaultValue: 'No plan usage reported.' })}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {windows.map((window) => (
        <UsageWindowRow key={window.id} window={window} />
      ))}
      {credits && <UsageCreditsRow credits={credits} />}
      {resetCredits && <UsageResetCreditsRow resetCredits={resetCredits} />}
      {activity && <UsageActivitySection activity={activity} collapsible />}
      {usage.stale && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('planUsage.stale', { defaultValue: 'Showing cached data — the last refresh failed.' })}
        </p>
      )}
    </div>
  );
}
