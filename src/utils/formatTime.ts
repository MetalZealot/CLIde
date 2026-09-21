import { useSyncExternalStore } from 'react';

/**
 * One hour cycle for every clock in CLIde, chosen in Appearance settings and
 * defaulting to 12-hour. Every surface formats through here rather than passing
 * `hour12` itself, so a new one cannot quietly diverge. The locale stays pinned
 * for a separate reason: the AM/PM marker and second-precision otherwise vary
 * between one user's phone and desktop for the same message.
 */
const CLOCK_LOCALE = 'en-US';

export type ClockFormat = '12h' | '24h';

export const isClockFormat = (value: unknown): value is ClockFormat =>
  value === '12h' || value === '24h';

let clockFormat: ClockFormat = '12h';
const listeners = new Set<() => void>();

/** Set by the appearance preferences provider; nothing else should call it. */
export function setClockFormat(next: ClockFormat): void {
  if (!isClockFormat(next) || next === clockFormat) return;
  clockFormat = next;
  listeners.forEach((listener) => listener());
}

export function getClockFormat(): ClockFormat {
  return clockFormat;
}

function subscribeToClockFormat(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Any component rendering a formatted time must call this, or it keeps the old
 * hour cycle until something else re-renders it.
 */
export function useClockFormat(): ClockFormat {
  return useSyncExternalStore(subscribeToClockFormat, getClockFormat, getClockFormat);
}

/** `hour12` and `hourCycle` conflict, so a caller picks one or the other. */
export const clockCycleOptions = (format: ClockFormat = clockFormat): Intl.DateTimeFormatOptions =>
  (format === '24h' ? { hourCycle: 'h23' } : { hour12: true });

type TimeInput = Date | number | string;

function toDate(value: TimeInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * "9:05 PM" or "21:05", with seconds when the caller needs them. `format`
 * overrides the stored setting, for a preview of a cycle not yet applied.
 */
export function formatClockTime(
  value: TimeInput,
  options: { withSeconds?: boolean; format?: ClockFormat } = {},
): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString(CLOCK_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' as const } : {}),
    ...clockCycleOptions(options.format),
  });
}

/** "Sep 8, 9:05 PM" — a date only carries a year when it is not this one. */
export function formatDateTime(value: TimeInput): string {
  const date = toDate(value);
  if (!date) return '';
  const day = date.toLocaleDateString(CLOCK_LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
  });
  return `${day}, ${formatClockTime(date)}`;
}

/**
 * A past message: "9:05 PM" today, "Yesterday, 9:05 PM", "Tue, 9:05 PM" within
 * the week, then the full date. Days are calendar days, not 24-hour spans.
 */
export function formatMessageTimestamp(value: TimeInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded so a DST shift's 23- or 25-hour day still counts as one.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (daysAgo === 0) return formatClockTime(date);
  if (daysAgo === 1) return `Yesterday, ${formatClockTime(date)}`;
  if (daysAgo > 1 && daysAgo < 7) {
    return `${date.toLocaleDateString(CLOCK_LOCALE, { weekday: 'short' })}, ${formatClockTime(date)}`;
  }
  return formatDateTime(date);
}

/** Today needs no date; anything further out is ambiguous without one. */
export function formatClockTimeWithDay(value: TimeInput): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toDateString() === new Date().toDateString()
    ? formatClockTime(date)
    : formatDateTime(date);
}
