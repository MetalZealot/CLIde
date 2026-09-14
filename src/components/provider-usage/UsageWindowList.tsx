import { ChevronDown, ExternalLink } from 'lucide-react';
import React, { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle, Shimmer } from '../../shared/view/ui';
import { cn } from '../../lib/utils';

import {
  formatResetLocal,
  formatResetsIn,
  formatUsageWindowLabel,
  isUsageWindowResetPending,
  prettifyUsageId,
  usageBarToneClass,
} from './format';
import type {
  ProviderUsageActivity,
  ProviderUsageBalanceCredits,
  ProviderUsageCredits,
  ProviderUsageResetCredits,
  ProviderUsageResetRedemptionInput,
  ProviderUsageResetRedemptionResult,
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

function UsageWindowRow({ window }: { window: ProviderUsageWindow }) {
  const { t } = useTranslation('common');
  const displayLabel = formatUsageWindowLabel(window, t);
  const resetsIn = formatResetsIn(window.resetsAt);
  const exactReset = formatResetLocal(window.resetsAt);
  const resetPending = isUsageWindowResetPending(window.resetsAt);
  const clamped = resetPending ? 0 : Math.min(100, Math.max(0, window.utilization));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {displayLabel}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {resetPending
            ? t('planUsage.windowReset', { defaultValue: 'Reset' })
            : t('planUsage.percentUsed', {
              defaultValue: '{{percent}}% used',
              percent: Math.round(clamped),
            })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', usageBarToneClass(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {resetsIn && (
        <p className="text-xs text-muted-foreground">
          {t('planUsage.resetsIn', { defaultValue: 'Resets in {{time}}', time: resetsIn })}
          {exactReset && ` · ${exactReset}`}
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
          className={cn('h-full rounded-full transition-[width]', usageBarToneClass(clamped))}
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
  const exactReset = individualLimit ? formatResetLocal(individualLimit.resetsAt) : null;
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
              className={cn(
                'h-full rounded-full transition-[width]',
                usageBarToneClass(individualUtilization),
              )}
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
                {exactReset && ` · ${exactReset}`}
              </span>
            )}
          </div>
        </div>
      )}

      {credits.limitReachedReason && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {REACHED_REASON_COPY[credits.limitReachedReason]
            ?? prettifyUsageId(credits.limitReachedReason)}
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

export function UsageResetCreditsRow({
  resetCredits,
  showDivider = true,
  onRedeem,
  redemptionDisabled = false,
  managementUrl,
}: {
  resetCredits: ProviderUsageResetCredits;
  showDivider?: boolean;
  onRedeem?: (
    input: ProviderUsageResetRedemptionInput,
  ) => Promise<ProviderUsageResetRedemptionResult>;
  redemptionDisabled?: boolean;
  managementUrl?: string;
}) {
  const { t } = useTranslation('common');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [redemptionUnsupported, setRedemptionUnsupported] = useState(false);
  const attemptKeyRef = useRef<string | null>(null);
  const descriptionId = useId();
  const availability = resetCredits.availableCount === 1
    ? t('planUsage.oneResetAvailable', { defaultValue: '1 available' })
    : t('planUsage.resetsAvailable', {
      defaultValue: '{{count}} available',
      count: resetCredits.availableCount,
    });
  const selectedCredit = [...(resetCredits.details ?? [])]
    .filter((credit) => credit.status === 'available')
    .sort((left, right) => {
      const leftExpiry = Date.parse(left.expiresAt ?? '');
      const rightExpiry = Date.parse(right.expiresAt ?? '');
      if (!Number.isFinite(leftExpiry) && !Number.isFinite(rightExpiry)) return 0;
      if (!Number.isFinite(leftExpiry)) return 1;
      if (!Number.isFinite(rightExpiry)) return -1;
      return leftExpiry - rightExpiry;
    })[0];
  const expiry = selectedCredit?.expiresAt ? formatResetLocal(selectedCredit.expiresAt) : null;

  const submitRedemption = async () => {
    if (!onRedeem) return;
    const idempotencyKey = attemptKeyRef.current
      ?? globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    attemptKeyRef.current = idempotencyKey;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await onRedeem({
        idempotencyKey,
        ...(selectedCredit?.id ? { creditId: selectedCredit.id } : {}),
      });
      attemptKeyRef.current = null;
      setIsConfirming(false);
      setResultMessage({
        reset: t('usageDashboard.resetApplied', { defaultValue: 'Usage reset applied.' }),
        nothingToReset: t('usageDashboard.nothingToReset', {
          defaultValue: 'Nothing needs resetting yet. Usage has been refreshed.',
        }),
        noCredit: t('usageDashboard.noResetCredit', {
          defaultValue: 'No reset is available. Usage has been refreshed.',
        }),
        alreadyRedeemed: t('usageDashboard.resetAlreadyRedeemed', {
          defaultValue: 'This reset was already used. Usage has been refreshed.',
        }),
      }[result.outcome]);
    } catch (error) {
      if (
        error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'USAGE_RESET_REDEMPTION_UNSUPPORTED'
      ) {
        setRedemptionUnsupported(true);
      }
      setSubmitError(error instanceof Error
        ? error.message
        : t('usageDashboard.resetFailed', { defaultValue: 'Unable to use this reset.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className={cn(
        'flex items-center justify-between gap-3',
        showDivider ? 'border-t border-border/60 pt-4' : 'py-4',
      )}>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {t('planUsage.usageLimitResets', { defaultValue: 'Usage limit resets' })}
          </div>
          {resultMessage && (
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {resultMessage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm font-semibold text-foreground">
            {availability}
          </span>
          {resetCredits.availableCount > 0 && onRedeem && !redemptionUnsupported && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={redemptionDisabled}
              title={redemptionDisabled
                ? t('usageDashboard.refreshBeforeReset', {
                  defaultValue: 'Refresh usage before using a reset.',
                })
                : undefined}
              onClick={() => {
                setResultMessage(null);
                setSubmitError(null);
                setIsConfirming(true);
              }}
            >
              {t('usageDashboard.useReset', { defaultValue: 'Use reset' })}
            </Button>
          )}
          {resetCredits.availableCount > 0
            && (!onRedeem || redemptionUnsupported)
            && managementUrl && (
            <a
              href={managementUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t('usageDashboard.openProviderUsage', { defaultValue: 'Open provider usage' })}
            </a>
          )}
        </div>
      </div>

      <Dialog
        open={isConfirming}
        onOpenChange={(open) => {
          if (!isSubmitting) setIsConfirming(open);
        }}
      >
        <DialogContent
          aria-describedby={descriptionId}
          className="w-[calc(100vw-2rem)] max-w-sm p-6"
        >
          <DialogTitle className="not-sr-only text-lg font-semibold text-foreground">
            {t('usageDashboard.confirmResetTitle', { defaultValue: 'Use one usage reset?' })}
          </DialogTitle>
          <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
            {t('usageDashboard.confirmResetDescription', {
              defaultValue: 'This refreshes eligible 5-hour and weekly limits and changes your next weekly reset date. It cannot be undone.',
            })}
          </p>
          {expiry && (
            <p className="mt-3 text-sm text-foreground">
              {t('usageDashboard.resetExpires', {
                defaultValue: 'This reset expires {{expiry}}.',
                expiry,
              })}
            </p>
          )}
          {submitError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          {redemptionUnsupported && managementUrl && (
            <a
              href={managementUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t('usageDashboard.openProviderUsage', { defaultValue: 'Open provider usage' })}
            </a>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsConfirming(false)}
            >
              {t('buttons.cancel', { defaultValue: 'Cancel' })}
            </Button>
            {!redemptionUnsupported && (
              <Button
                type="button"
                size="sm"
                disabled={isSubmitting}
                onClick={() => { void submitRedemption(); }}
              >
                {isSubmitting
                  ? t('usageDashboard.usingReset', { defaultValue: 'Using reset…' })
                  : t('usageDashboard.useReset', { defaultValue: 'Use reset' })}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
