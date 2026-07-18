import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../shared/view/ui';
import { cn } from '../../lib/utils';

import type { ProviderUsageStatus, ProviderUsageWindow } from './types';

type UsageWindowListProps = {
  usage: ProviderUsageStatus | null;
  loading: boolean;
  error: string | null;
};

const KNOWN_WINDOW_LABELS: Record<string, { key: string; defaultValue: string }> = {
  five_hour: { key: 'planUsage.fiveHour', defaultValue: '5-hour limit' },
  seven_day: { key: 'planUsage.weekly', defaultValue: 'Weekly limit' },
  seven_day_opus: { key: 'planUsage.weeklyOpus', defaultValue: 'Weekly limit (Opus)' },
  seven_day_sonnet: { key: 'planUsage.weeklySonnet', defaultValue: 'Weekly limit (Sonnet)' },
};

const prettifyWindowId = (id: string): string => (
  id.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase())
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

const formatResetsIn = (resetsAt: string | null): string | null => {
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
  const label = KNOWN_WINDOW_LABELS[window.id];
  const resetsIn = formatResetsIn(window.resetsAt);
  const clamped = Math.min(100, Math.max(0, window.utilization));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {label ? t(label.key, { defaultValue: label.defaultValue }) : prettifyWindowId(window.id)}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {Math.round(clamped)}%
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

/**
 * Renders provider plan rate-limit windows (5-hour/weekly utilization bars).
 * Renders nothing when the provider/auth method has no plan usage; callers
 * decide whether to show an explanatory note instead.
 */
export default function UsageWindowList({ usage, loading, error }: UsageWindowListProps) {
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
  if (windows.length === 0) {
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
      {usage.stale && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('planUsage.stale', { defaultValue: 'Showing cached data — the last refresh failed.' })}
        </p>
      )}
    </div>
  );
}
