import type { ProviderUsageWindow } from './types';

/** Structural shape of i18next's `t`, so this module stays free of React/i18n. */
type TranslateFn = (key: string, options: { defaultValue: string }) => string;

const KNOWN_WINDOW_LABELS: Record<string, { key: string; defaultValue: string }> = {
  five_hour: { key: 'planUsage.fiveHour', defaultValue: '5-hour limit' },
  seven_day: { key: 'planUsage.weekly', defaultValue: 'Weekly limit' },
  seven_day_opus: { key: 'planUsage.weeklyOpus', defaultValue: 'Weekly limit (Opus)' },
  seven_day_sonnet: { key: 'planUsage.weeklySonnet', defaultValue: 'Weekly limit (Sonnet)' },
};

/** Last resort for an unrecognized id: `seven_day_max` -> `Seven day max`. */
export const prettifyUsageId = (id: string): string => (
  id.replace(/[:_]/g, ' ').replace(/^\w/, (character) => character.toUpperCase())
);

const durationLabel = (durationMinutes: number, t: TranslateFn): string => {
  if (durationMinutes === 300) return t('planUsage.fiveHour', { defaultValue: '5-hour limit' });
  if (durationMinutes === 10_080) return t('planUsage.weekly', { defaultValue: 'Weekly limit' });
  if (durationMinutes % 1440 === 0) return `${durationMinutes / 1440}-day limit`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}-hour limit`;
  return `${durationMinutes} minute limit`;
};

/**
 * The one name a usage window is shown under, everywhere it appears.
 *
 * Derived rather than stored because providers name the same window
 * inconsistently: known ids get a translated name, an unknown id with a
 * duration gets one built from that duration, and anything left falls back to
 * the id itself. A provider-supplied `label` qualifies the window (the model a
 * weekly limit applies to, say) rather than replacing it, so it is prefixed.
 */
export const formatUsageWindowLabel = (window: ProviderUsageWindow, t: TranslateFn): string => {
  const known = KNOWN_WINDOW_LABELS[window.id];
  const base = known
    ? t(known.key, { defaultValue: known.defaultValue })
    : window.durationMinutes
      ? durationLabel(window.durationMinutes, t)
      : prettifyUsageId(window.id);

  return window.label ? `${window.label} · ${base}` : base;
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

export const formatResetLocal = (resetsAt: string | null): string | null => {
  if (!resetsAt) return null;
  const timestamp = Date.parse(resetsAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(timestamp));
};

export const usageBarToneClass = (utilization: number): string => {
  if (utilization >= 90) return 'bg-red-500';
  if (utilization >= 75) return 'bg-amber-500';
  return 'bg-emerald-500';
};

export const formatUpdatedAgo = (fetchedAt: string): string | null => {
  const elapsedMs = Date.now() - Date.parse(fetchedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return formatter.format(0, 'second');
  if (minutes < 60) return formatter.format(-minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.floor(hours / 24), 'day');
};
