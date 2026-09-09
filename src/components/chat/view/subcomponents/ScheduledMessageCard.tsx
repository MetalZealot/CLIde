import { useTranslation } from 'react-i18next';
import { ClockIcon, XIcon } from 'lucide-react';

import type { ScheduledMessage } from '../../hooks/useScheduledMessages';

interface ScheduledMessageCardProps {
  message: ScheduledMessage;
  onCancel: (id: string) => void;
}

/** Same slot and shape as the queued-message card, so both read as "not sent yet". */
export default function ScheduledMessageCard({ message, onCancel }: ScheduledMessageCardProps) {
  const { t } = useTranslation('chat');

  const when = message.trigger === 'usage-reset'
    ? t('input.schedule.whenUsageResets', { defaultValue: 'Sending when usage resets' })
    : t('input.schedule.whenAt', {
      defaultValue: 'Sending at {{time}}',
      time: message.scheduledFor
        ? new Date(message.scheduledFor).toLocaleString(undefined, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
        : '',
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

        <button
          type="button"
          onClick={() => onCancel(message.id)}
          aria-label={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
          title={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
