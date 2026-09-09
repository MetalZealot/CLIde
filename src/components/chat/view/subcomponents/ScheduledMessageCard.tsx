import { useTranslation } from 'react-i18next';
import { ClockIcon, PencilIcon, XIcon } from 'lucide-react';

import type { ScheduledMessage } from '../../hooks/useScheduledMessages';

interface ScheduledMessageCardProps {
  message: ScheduledMessage;
  onCancel: (id: string) => void;
  onEdit: (message: ScheduledMessage) => void;
}

/** Today needs no weekday; anything further out is ambiguous without one. */
function formatWhen(at: Date): string {
  const clock = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString()
    ? clock
    : `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clock}`;
}

/** Same slot and shape as the queued-message card, so both read as "not sent yet". */
export default function ScheduledMessageCard({ message, onCancel, onEdit }: ScheduledMessageCardProps) {
  const { t } = useTranslation('chat');

  const when = message.trigger === 'usage-reset'
    ? t('input.schedule.whenUsageResets', { defaultValue: 'Sending when usage resets' })
    : t('input.schedule.whenAt', {
      defaultValue: 'Sending at {{time}}',
      time: message.scheduledFor ? formatWhen(new Date(message.scheduledFor)) : '',
    });

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <ClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-primary/70">
            {when}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-foreground/90">
            {message.content}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEdit(message)}
            aria-label={t('input.schedule.edit', { defaultValue: 'Edit scheduled message' })}
            title={t('input.schedule.edit', { defaultValue: 'Edit scheduled message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onCancel(message.id)}
            aria-label={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
            title={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
