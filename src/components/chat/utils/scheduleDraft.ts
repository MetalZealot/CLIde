import type { ScheduledMessageTrigger } from '../hooks/useScheduledMessages';

export type ScheduleUnit = 'minutes' | 'hours' | 'days';

/** The schedule banner's raw fields; resolved to an instant only at send time. */
export interface ScheduleDraft {
  amount: string;
  unit: ScheduleUnit;
  /** `datetime-local` value; overrides the relative amount while set. */
  exact: string | null;
  onUsageReset: boolean;
}

const UNIT_MS: Record<ScheduleUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function initialScheduleDraft(onUsageReset = false): ScheduleDraft {
  return { amount: '30', unit: 'minutes', exact: null, onUsageReset };
}

/** The instant a time-based draft lands on, or null while its fields are invalid. */
export function scheduleDraftTarget(draft: ScheduleDraft, now = Date.now()): Date | null {
  if (draft.exact) {
    const exact = new Date(draft.exact);
    if (Number.isFinite(exact.getTime())) return exact;
  }
  const amount = Number.parseInt(draft.amount, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return new Date(now + amount * UNIT_MS[draft.unit]);
}

export function resolveScheduleDraft(
  draft: ScheduleDraft,
  now = Date.now(),
): { trigger: ScheduledMessageTrigger; scheduledFor: string | null } | null {
  if (draft.onUsageReset) return { trigger: 'usage-reset', scheduledFor: null };
  const target = scheduleDraftTarget(draft, now);
  return target ? { trigger: 'time', scheduledFor: target.toISOString() } : null;
}

/** `datetime-local` wants local wall-clock time, not the ISO instant we store. */
export function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
