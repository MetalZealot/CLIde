import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClockIcon, RotateCcwIcon } from 'lucide-react';

import {
  ContextMenuOverlay,
  Dialog,
  DialogContent,
  DialogTitle,
  type ContextMenuAnchor,
} from '../../../../shared/view/ui';
import type { ScheduledMessageTrigger } from '../../hooks/useScheduledMessages';

interface ScheduleSendMenuProps {
  anchor: ContextMenuAnchor;
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

export default function ScheduleSendMenu({
  anchor,
  canWaitForUsageReset,
  onDismiss,
  onSchedule,
}: ScheduleSendMenuProps) {
  const { t } = useTranslation('chat');
  const [isPickingTime, setIsPickingTime] = useState(false);
  const [when, setWhen] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60_000)));

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

  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onDismiss}
      ariaLabel={t('input.schedule.menuLabel', { defaultValue: 'Send later' })}
      className="min-w-[220px] px-1 py-1"
    >
      {canWaitForUsageReset && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onSchedule('usage-reset', null)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
        >
          <RotateCcwIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">
            {t('input.schedule.onUsageReset', { defaultValue: 'Send when usage resets' })}
          </span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => setIsPickingTime(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
      >
        <CalendarClockIcon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          {t('input.schedule.atATime', { defaultValue: 'Send at a time…' })}
        </span>
      </button>
    </ContextMenuOverlay>
  );
}
