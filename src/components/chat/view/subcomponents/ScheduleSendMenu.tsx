import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClockIcon, ClockIcon, RotateCcwIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type { ScheduledMessageTrigger } from '../../hooks/useScheduledMessages';

interface ScheduleSendMenuProps {
  /** False on Cursor and OpenCode, which have no usage reset to wait on. */
  canWaitForUsageReset: boolean;
  onDismiss: () => void;
  onSchedule: (trigger: ScheduledMessageTrigger, scheduledFor: string | null) => void;
}

/** `datetime-local` wants local wall-clock time, not the ISO instant we store. */
function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function atLocalHour(dayOffset: number, hour: number): Date {
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  target.setHours(hour, 0, 0, 0);
  return target;
}

const formatClock = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Presets first, calendar last.
 *
 * The wheel is the slowest way to say "in a few minutes" on a phone, and a
 * default an hour out reads as a typo rather than a choice — so the common
 * delays are one tap each and the native picker only appears behind Custom.
 */
function buildPresets(t: (key: string, options: Record<string, unknown>) => string) {
  const tonight = atLocalHour(0, 21);
  const tomorrow = atLocalHour(1, 9);

  return [
    {
      key: 'in-15',
      label: t('input.schedule.in15', { defaultValue: 'In 15 minutes' }),
      at: () => new Date(Date.now() + 15 * 60_000),
    },
    {
      key: 'in-60',
      label: t('input.schedule.in60', { defaultValue: 'In 1 hour' }),
      at: () => new Date(Date.now() + 60 * 60_000),
    },
    // Offered only while it is still ahead; past 9pm it would mean yesterday.
    ...(tonight.getTime() > Date.now() ? [{
      key: 'tonight',
      label: t('input.schedule.tonight', {
        defaultValue: 'Tonight, {{time}}',
        time: formatClock(tonight),
      }),
      at: () => atLocalHour(0, 21),
    }] : []),
    {
      key: 'tomorrow',
      label: t('input.schedule.tomorrow', {
        defaultValue: 'Tomorrow, {{time}}',
        time: formatClock(tomorrow),
      }),
      at: () => atLocalHour(1, 9),
    },
  ];
}

export default function ScheduleSendMenu({
  canWaitForUsageReset,
  onDismiss,
  onSchedule,
}: ScheduleSendMenuProps) {
  const { t } = useTranslation('chat');
  const [isPickingTime, setIsPickingTime] = useState(false);
  const [when, setWhen] = useState(() => toLocalInputValue(new Date(Date.now() + 15 * 60_000)));

  if (isPickingTime) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onDismiss(); }}>
        <DialogContent className="max-w-xs">
          <DialogTitle>
            {t('input.schedule.pickTime', { defaultValue: 'Send at a time' })}
          </DialogTitle>
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              disabled={!when}
              onClick={() => onSchedule('time', new Date(when).toISOString())}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {t('input.schedule.confirm', { defaultValue: 'Schedule' })}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const itemClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none';

  return (
    // A sheet, not a popover: the soft keyboard closing on long-press reflows
    // the composer, which left an anchored menu floating where the button used
    // to be. The bottom edge is the one thing the keyboard cannot move.
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />

      <div
        role="menu"
        aria-label={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
        className="settings-content-enter relative mx-auto w-full max-w-md rounded-t-2xl border border-border bg-popover p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-lg"
      >
        {canWaitForUsageReset && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => onSchedule('usage-reset', null)}
              className={itemClass}
            >
              <RotateCcwIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">
                {t('input.schedule.onUsageReset', { defaultValue: 'When usage resets' })}
              </span>
            </button>
            <div className="mx-3 my-1 h-px bg-border" />
          </>
        )}

        {buildPresets(t).map((preset) => (
          <button
            key={preset.key}
            type="button"
            role="menuitem"
            onClick={() => onSchedule('time', preset.at().toISOString())}
            className={itemClass}
          >
            <ClockIcon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{preset.label}</span>
          </button>
        ))}

        <button
          type="button"
          role="menuitem"
          onClick={() => setIsPickingTime(true)}
          className={itemClass}
        >
          <CalendarClockIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">
            {t('input.schedule.custom', { defaultValue: 'Custom…' })}
          </span>
        </button>
      </div>
    </div>
  );
}
