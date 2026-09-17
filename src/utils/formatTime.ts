/**
 * Clock times are 12-hour throughout CLIde, deliberately.
 *
 * The device locale decides otherwise on this maintainer's phone, and a
 * 24-hour time reads as a bug to him wherever it appears. Every surface goes
 * through here rather than passing `hour12` itself, so a new one cannot
 * quietly reintroduce it. The locale is pinned for the same reason the chat
 * timestamp pins it: the AM/PM marker and second-precision otherwise vary
 * between his phone and his desktop for the same message.
 */
const CLOCK_LOCALE = 'en-US';

type TimeInput = Date | number | string;

function toDate(value: TimeInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** "9:05 PM", or "9:05:31 PM" when the caller needs seconds. */
export function formatClockTime(value: TimeInput, options: { withSeconds?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString(CLOCK_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' as const } : {}),
    hour12: true,
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
