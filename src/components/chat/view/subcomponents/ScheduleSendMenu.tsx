import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClockIcon, RotateCcwIcon } from 'lucide-react';

import { formatClockTimeWithDay } from '../../../../utils/formatTime';
import type { ScheduledMessageTrigger } from '../../hooks/useScheduledMessages';

interface ScheduleSendMenuProps {
  /** False on Cursor and OpenCode, which have no usage reset to wait on. */
  canWaitForUsageReset: boolean;
  onDismiss: () => void;
  onSchedule: (trigger: ScheduledMessageTrigger, scheduledFor: string | null) => void;
}

type Unit = 'minutes' | 'hours' | 'days';

const UNIT_MS: Record<Unit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** `datetime-local` wants local wall-clock time, not the ISO instant we store. */
function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Relative first, absolute behind a link.
 *
 * Every real use of this is "resume in a while", not "resume at 14:05" — and
 * the platform's own date-time control is a six-wheel modal that ignores the
 * app's 12-hour rule. So the common case is a number and a unit, with the
 * instant it lands on spelled out underneath.
 */
export default function ScheduleSendMenu({
  canWaitForUsageReset,
  onDismiss,
  onSchedule,
}: ScheduleSendMenuProps) {
  const { t } = useTranslation('chat');
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<Unit>('minutes');
  const [exact, setExact] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const parsedAmount = Number.parseInt(amount, 10);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const relativeTarget = isAmountValid
    ? new Date(Date.now() + parsedAmount * UNIT_MS[unit])
    : null;
  const exactTarget = exact ? new Date(exact) : null;
  const target = exactTarget && Number.isFinite(exactTarget.getTime())
    ? exactTarget
    : relativeTarget;

  const scheduleRelative = () => {
    if (target) onSchedule('time', target.toISOString());
  };

  return createPortal(
    // A sheet in a portal, not a popover on the button: long-pressing send
    // closes the soft keyboard, which reflows the composer out from under an
    // anchored menu, and an ancestor of the composer was swallowing the
    // scrim's own dismiss.
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
        className="settings-content-enter relative mx-auto w-full max-w-md rounded-t-2xl border border-border bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg"
      >
        {canWaitForUsageReset && (
          <>
            <button
              type="button"
              onClick={() => onSchedule('usage-reset', null)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
            >
              <RotateCcwIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">
                {t('input.schedule.onUsageReset', { defaultValue: 'When usage resets' })}
              </span>
            </button>
            <div className="my-2 h-px bg-border" />
          </>
        )}

        <div className="px-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('input.schedule.sendIn', { defaultValue: 'Send in' })}
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setExact(null); }}
              className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-center text-sm"
            />
            <select
              value={unit}
              onChange={(event) => { setUnit(event.target.value as Unit); setExact(null); }}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="minutes">{t('input.schedule.minutes', { defaultValue: 'minutes' })}</option>
              <option value="hours">{t('input.schedule.hours', { defaultValue: 'hours' })}</option>
              <option value="days">{t('input.schedule.days', { defaultValue: 'days' })}</option>
            </select>
          </div>

          <p className="mt-2 min-h-[1.25rem] text-xs text-muted-foreground">
            {target
              ? t('input.schedule.sendsAt', {
                defaultValue: 'Sends at {{time}}',
                time: formatClockTimeWithDay(target),
              })
              : t('input.schedule.needsAmount', { defaultValue: 'Enter how long to wait' })}
          </p>

          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarClockIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="shrink-0">
              {t('input.schedule.orExactly', { defaultValue: 'or exactly' })}
            </span>
            <input
              type="datetime-local"
              value={exact ?? toLocalInputValue(target ?? new Date())}
              onChange={(event) => setExact(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={!target}
            onClick={scheduleRelative}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {t('input.schedule.confirm', { defaultValue: 'Schedule' })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
