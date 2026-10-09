import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon, RotateCcwIcon, TimerIcon, XIcon } from 'lucide-react';

import { formatClockTimeWithDay, useClockFormat } from '../../../../utils/formatTime';
import {
  scheduleDraftTarget,
  toLocalInputValue,
  type ScheduleDraft,
  type ScheduleUnit,
} from '../../utils/scheduleDraft';

interface ScheduleBannerProps {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  onClose: () => void;
  /** False on providers with no usage reset to wait on, which omits that chip. */
  canWaitForUsageReset: boolean;
  /** Set when schedule mode opened because Send met spent usage. */
  usageSpent?: { windowLabel: string; resetsAt: string } | null;
  onSendNow?: () => void;
}

/**
 * Schedule mode's controls, above the composer; the timer Send commits them.
 * Two rows on phones, one from `md` up: `order` moves the close button and a
 * full-width break so both layouts come from one tree.
 */
export default function ScheduleBanner({
  draft,
  onChange,
  onClose,
  canWaitForUsageReset,
  usageSpent = null,
  onSendNow,
}: ScheduleBannerProps) {
  const { t } = useTranslation('chat');
  useClockFormat();
  // Ticks so "at 7:14 PM" tracks a relative amount as time passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const target = scheduleDraftTarget(draft, now);
  const relativeDimmed = draft.onUsageReset || Boolean(draft.exact);
  const edit = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });

  const timeLabel = draft.onUsageReset
    ? usageSpent
      ? t('input.schedule.atUsageResetTime', {
        defaultValue: 'when usage resets ({{time}})',
        time: formatClockTimeWithDay(usageSpent.resetsAt),
      })
      : t('input.schedule.atUsageReset', { defaultValue: 'when usage resets' })
    : target
      ? t('input.schedule.atTime', { defaultValue: 'at {{time}}', time: formatClockTimeWithDay(target) })
      : t('input.schedule.needsAmount', { defaultValue: 'Enter how long to wait' });

  return (
    <div
      role="group"
      aria-label={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
      className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-border bg-card px-3 py-2 text-sm"
    >
      {usageSpent && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <p role="status" className="flex-1">
            {t('input.schedule.usageSpent', {
              defaultValue: '{{window}} is used up until {{time}}.',
              window: usageSpent.windowLabel,
              time: formatClockTimeWithDay(usageSpent.resetsAt),
            })}
          </p>
          {onSendNow && (
            <button
              type="button"
              onClick={onSendNow}
              className="shrink-0 rounded-md px-2 py-1 text-muted-foreground underline-offset-2 hover:bg-accent hover:text-foreground hover:underline"
            >
              {t('input.schedule.sendAnyway', { defaultValue: 'Send now anyway' })}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className={`order-1 flex items-center gap-2 transition-opacity ${relativeDimmed ? 'opacity-50' : ''}`}>
          <TimerIcon className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">
            {t('input.schedule.sendIn', { defaultValue: 'Send in' })}
          </span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            aria-label={t('input.schedule.amount', { defaultValue: 'How long to wait' })}
            value={draft.amount}
            onChange={(event) => edit({ amount: event.target.value, exact: null, onUsageReset: false })}
            className="w-14 rounded-md border border-input bg-background px-2 py-1 text-center"
          />
          <select
            aria-label={t('input.schedule.unit', { defaultValue: 'Unit' })}
            value={draft.unit}
            onChange={(event) => edit({ unit: event.target.value as ScheduleUnit, exact: null, onUsageReset: false })}
            className="rounded-md border border-input bg-background px-2 py-1"
          >
            <option value="minutes">{t('input.schedule.minutes', { defaultValue: 'minutes' })}</option>
            <option value="hours">{t('input.schedule.hours', { defaultValue: 'hours' })}</option>
            <option value="days">{t('input.schedule.days', { defaultValue: 'days' })}</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          title={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          className="order-2 ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:order-5"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <div className="order-3 basis-full md:hidden" aria-hidden="true" />

        {/* The transparent native input sits over the label, so a tap opens the platform picker. */}
        <label className="relative order-4 flex min-w-0 items-center gap-0.5 rounded-md py-1 pl-6 text-xs text-muted-foreground hover:text-foreground md:pl-0">
          <span className="truncate">{timeLabel}</span>
          <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <input
            type="datetime-local"
            aria-label={t('input.schedule.orExactly', { defaultValue: 'Pick an exact time' })}
            value={draft.exact ?? toLocalInputValue(target ?? new Date(now))}
            onChange={(event) => edit({ exact: event.target.value || null, onUsageReset: false })}
            onClick={(event: MouseEvent<HTMLInputElement>) => {
              // Desktop Chrome only opens the picker from its own calendar icon otherwise.
              try { event.currentTarget.showPicker?.(); } catch { /* picker already open */ }
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        {canWaitForUsageReset && (
          <button
            type="button"
            aria-pressed={draft.onUsageReset}
            onClick={() => edit({ onUsageReset: !draft.onUsageReset })}
            className={`order-4 ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors md:ml-0 ${
              draft.onUsageReset
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('input.schedule.onUsageReset', { defaultValue: 'When usage resets' })}
          </button>
        )}
      </div>
    </div>
  );
}
