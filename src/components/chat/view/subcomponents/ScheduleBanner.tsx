import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClockIcon, RotateCcwIcon, TimerIcon, XIcon } from 'lucide-react';

import { formatClockTimeWithDay, useClockFormat } from '../../../../utils/formatTime';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import {
  scheduleDraftTarget,
  toLocalInputValue,
  type ScheduleDraft,
  type ScheduleUnit,
} from '../../utils/scheduleDraft';

import { ComposerMenuItem, ComposerMenuSeparator, ComposerMenuSurface } from './ComposerMenuPrimitives';

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

const UNITS: ScheduleUnit[] = ['minutes', 'hours', 'days'];

/** A borderless control that reads as a word in the sentence: primary text, dashed underline. */
const TOKEN_CLASS = 'border-b-[1.5px] border-dashed border-primary/40 bg-transparent px-px font-medium leading-6 text-primary focus-visible:border-solid focus-visible:border-primary focus-visible:outline-none';

/**
 * Schedule mode's controls as one tappable sentence above the composer:
 * "Send in 30 minutes · 7:58 PM". The timer Send commits it.
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

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isMenuOpen, closeMenu, 15 * 16);
  const pickerRef = useRef<HTMLInputElement>(null);

  const target = scheduleDraftTarget(draft, now);
  const edit = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const isRelative = !draft.onUsageReset && !draft.exact;
  const unitLabel = (unit: ScheduleUnit) => t(`input.schedule.${unit}`, { defaultValue: unit });

  const openExactPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    picker.value = draft.exact ?? toLocalInputValue(target ?? new Date(now));
    // Needs the tap's user activation, so it runs inside the menu item's click.
    try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
  };

  const landsAt = draft.onUsageReset
    ? usageSpent ? formatClockTimeWithDay(usageSpent.resetsAt) : null
    : draft.exact ? null : target ? formatClockTimeWithDay(target) : null;

  const menuLabel = t('input.schedule.when', { defaultValue: 'When to send' });
  const tokenLabel = draft.onUsageReset
    ? t('input.schedule.atUsageReset', { defaultValue: 'when usage resets' })
    : draft.exact && target
      ? t('input.schedule.atTime', { defaultValue: 'at {{time}}', time: formatClockTimeWithDay(target) })
      : unitLabel(draft.unit);

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-border bg-card px-3 text-sm">
      {usageSpent && (
        <div className="flex items-center gap-2 pt-2 text-xs">
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
              className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t('input.schedule.sendAnyway', { defaultValue: 'Send now anyway' })}
            </button>
          )}
        </div>
      )}

      <div
        role="group"
        aria-label={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
        className="-mr-2 flex min-h-10 items-center gap-1.5"
      >
        <TimerIcon className="mr-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">
          {isRelative
            ? t('input.schedule.sendIn', { defaultValue: 'Send in' })
            : t('input.schedule.send', { defaultValue: 'Send' })}
        </span>

        {isRelative && (
          <input
            type="text"
            inputMode="numeric"
            aria-label={t('input.schedule.amount', { defaultValue: 'How long to wait' })}
            value={draft.amount}
            onChange={(event) => edit({ amount: event.target.value.replace(/\D/g, '').slice(0, 3) })}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: `${Math.max(1, draft.amount.length) + 0.6}ch` }}
            className={`${TOKEN_CLASS} shrink-0 text-center tabular-nums`}
          />
        )}

        <span className="relative min-w-0">
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen && anchor !== null}
            aria-label={`${menuLabel}: ${tokenLabel}`}
            onClick={() => {
              if (isMenuOpen) {
                closeMenu();
                return;
              }
              updateAnchor();
              setIsMenuOpen(true);
            }}
            className={`${TOKEN_CLASS} block max-w-full truncate`}
          >
            {tokenLabel}
          </button>
          {/* Invisible, under the token, so the desktop picker opens beside it. */}
          <input
            ref={pickerRef}
            type="datetime-local"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => { if (event.target.value) edit({ exact: event.target.value, onUsageReset: false }); }}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </span>

        {landsAt && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground" aria-hidden="true">·</span>
            <span className="truncate font-semibold tabular-nums text-foreground">{landsAt}</span>
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          title={t('input.schedule.disarm', { defaultValue: 'Stop scheduling' })}
          className={`${landsAt ? '' : 'ml-auto '}flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <XIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isMenuOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={menuLabel}>
          {UNITS.map((unit) => (
            <ComposerMenuItem
              key={unit}
              role="menuitemradio"
              isSelected={isRelative && draft.unit === unit}
              label={unitLabel(unit)}
              onSelect={() => {
                closeMenu();
                edit({ unit, exact: null, onUsageReset: false });
              }}
            />
          ))}
          <ComposerMenuSeparator />
          <ComposerMenuItem
            role="menuitemradio"
            isSelected={Boolean(draft.exact) && !draft.onUsageReset}
            icon={<CalendarClockIcon className="h-4 w-4 text-muted-foreground" />}
            label={t('input.schedule.exactTime', { defaultValue: 'Exact time…' })}
            onSelect={() => {
              closeMenu();
              openExactPicker();
            }}
          />
          {canWaitForUsageReset && (
            <ComposerMenuItem
              role="menuitemradio"
              isSelected={draft.onUsageReset}
              icon={<RotateCcwIcon className="h-4 w-4 text-muted-foreground" />}
              label={t('input.schedule.onUsageReset', { defaultValue: 'When usage resets' })}
              onSelect={() => {
                closeMenu();
                edit({ onUsageReset: true, exact: null });
              }}
            />
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </div>
  );
}
