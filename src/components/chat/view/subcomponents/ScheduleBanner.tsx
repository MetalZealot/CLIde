import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TimerIcon, XIcon } from 'lucide-react';

import { composerNoticeActionClass } from '../../../../shared/view/ui';
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
  /** False on providers with no usage reset to wait on, which omits that menu item. */
  canWaitForUsageReset: boolean;
  /** Set when schedule mode opened because Send met spent usage. */
  usageSpent?: { windowLabel: string; resetsAt: string } | null;
  onSendNow?: () => void;
}

/** The menu's value: a unit, the usage reset, or an exact time picked from the time text. */
type ScheduleChoice = ScheduleUnit | 'usage-reset' | 'exact';

/**
 * Schedule mode's controls, one row above the composer at a notice's height;
 * the timer Send commits them. Units and the usage reset share one menu, and
 * the time text opens the platform picker for an exact time.
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
  // Ticks so the landing time tracks a relative amount as time passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const target = scheduleDraftTarget(draft, now);
  const edit = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const choice: ScheduleChoice = draft.onUsageReset ? 'usage-reset' : draft.exact ? 'exact' : draft.unit;

  const choose = (next: ScheduleChoice) => {
    if (next === 'usage-reset') edit({ onUsageReset: true, exact: null });
    else if (next !== 'exact') edit({ unit: next, onUsageReset: false, exact: null });
  };

  const landsAt = draft.onUsageReset
    ? usageSpent ? formatClockTimeWithDay(usageSpent.resetsAt) : t('input.schedule.nextReset', { defaultValue: 'next reset' })
    : target ? formatClockTimeWithDay(target) : t('input.schedule.needsAmount', { defaultValue: 'Enter how long to wait' });

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem]">
      <div
        role="group"
        aria-label={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
        className="flex items-center gap-2 rounded-xl border border-border bg-card py-1 pl-3 pr-1 text-sm"
      >
        {usageSpent && (
          // The row's time already says when; the limit's name is for screen readers.
          <span role="status" className="sr-only">
            {t('input.schedule.usageSpent', {
              defaultValue: '{{window}} is used up until {{time}}.',
              window: usageSpent.windowLabel,
              time: formatClockTimeWithDay(usageSpent.resetsAt),
            })}
          </span>
        )}

        <TimerIcon className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />

        {choice !== 'usage-reset' && choice !== 'exact' && (
          <input
            type="number"
            min={1}
            inputMode="numeric"
            aria-label={t('input.schedule.amount', { defaultValue: 'How long to wait' })}
            value={draft.amount}
            onChange={(event) => edit({ amount: event.target.value, exact: null, onUsageReset: false })}
            className="h-8 w-12 shrink-0 rounded-md border border-input bg-background px-1 text-center"
          />
        )}

        <select
          aria-label={t('input.schedule.when', { defaultValue: 'When to send' })}
          value={choice}
          onChange={(event) => choose(event.target.value as ScheduleChoice)}
          className="h-8 shrink-0 rounded-md border border-input bg-background px-2"
        >
          <option value="minutes">{t('input.schedule.minutes', { defaultValue: 'minutes' })}</option>
          <option value="hours">{t('input.schedule.hours', { defaultValue: 'hours' })}</option>
          <option value="days">{t('input.schedule.days', { defaultValue: 'days' })}</option>
          {choice === 'exact' && (
            <option value="exact">{t('input.schedule.exactTime', { defaultValue: 'at a set time' })}</option>
          )}
          {canWaitForUsageReset && (
            <option value="usage-reset">
              {usageSpent
                ? t('input.schedule.usageResetShort', { defaultValue: 'Usage reset' })
                : t('input.schedule.onUsageReset', { defaultValue: 'When usage resets' })}
            </option>
          )}
        </select>

        {/* The transparent native input sits over the text, so a tap opens the platform picker. */}
        <label className="relative flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground">
          <span aria-hidden="true">→</span>
          <span className="truncate font-medium text-foreground">{landsAt}</span>
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

        {usageSpent && onSendNow && (
          <button type="button" onClick={onSendNow} className={composerNoticeActionClass}>
            {t('input.schedule.sendNow', { defaultValue: 'Send now' })}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          title={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
