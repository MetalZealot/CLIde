import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ClockIcon, PauseIcon, PencilIcon, PlayIcon, SendIcon, XIcon } from 'lucide-react';

import { formatClockTimeWithDay, useClockFormat } from '../../../../utils/formatTime';
import { isImageAttachment } from '../../hooks/useChatComposerState';
import type { ScheduledMessage } from '../../hooks/useScheduledMessages';

import ChatMessageFiles from './ChatMessageFiles';
import ChatMessageImages from './ChatMessageImages';

interface ScheduledMessageBubblesProps {
  messages: ScheduledMessage[];
  /** False while a reply runs in this session, which the server would refuse a send into. */
  canSendNow: boolean;
  onSendNow: (id: string) => void;
  onEdit: (message: ScheduledMessage) => void;
  onCancel: (id: string) => void;
  onResume: (id: string) => void;
}

function describeWhen(message: ScheduledMessage, t: TFunction<'chat'>): string {
  if (message.state === 'paused') {
    return t('input.schedule.paused', { defaultValue: 'Paused — not sending until you resume it' });
  }
  return message.trigger === 'usage-reset'
    ? t('input.schedule.whenUsageResets', { defaultValue: 'Sending when usage resets' })
    : t('input.schedule.whenAt', {
      defaultValue: 'Sending at {{time}}',
      time: message.scheduledFor ? formatClockTimeWithDay(message.scheduledFor) : '',
    });
}

const actionButton = 'rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/** Unsent messages at the end of the thread, oldest first, with their actions beneath like a sent message's. */
export default function ScheduledMessageBubbles({
  messages,
  canSendNow,
  onSendNow,
  onEdit,
  onCancel,
  onResume,
}: ScheduledMessageBubblesProps) {
  const { t } = useTranslation('chat');
  useClockFormat();

  if (messages.length === 0) return null;

  return (
    <>
      {[...messages].reverse().map((message) => {
        const isPaused = message.state === 'paused';
        const attachments = message.attachments ?? [];
        const images = attachments.filter(isImageAttachment);
        const files = attachments.filter((attachment) => !isImageAttachment(attachment));
        const StatusIcon = isPaused ? PauseIcon : ClockIcon;
        const sendNowLabel = canSendNow
          ? t('input.schedule.sendNow', { defaultValue: 'Send now' })
          : t('input.schedule.sendNowBusy', { defaultValue: 'Send now is available once the current reply finishes' });
        return (
          <div key={message.id} className="chat-message flex justify-end px-1 sm:px-0">
            <div className="flex max-w-[85%] flex-col items-end gap-1 md:max-w-md lg:max-w-lg xl:max-w-xl">
              {images.length > 0 && <ChatMessageImages images={images} />}
              {files.length > 0 && <ChatMessageFiles files={files} />}
              <div className="max-w-full rounded-2xl border border-dashed border-blue-600/50 bg-blue-600/[0.08] px-3 py-2 text-foreground dark:border-blue-400/50 dark:bg-blue-400/10 sm:px-4">
                <p dir="auto" className="chat-reading line-clamp-6 whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              </div>
              <div className="-mt-0.5 flex select-none flex-col items-end px-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-x-0.5">
                  <button
                    type="button"
                    onClick={() => onEdit(message)}
                    aria-label={t('input.schedule.edit', { defaultValue: 'Edit scheduled message' })}
                    title={t('input.schedule.edit', { defaultValue: 'Edit scheduled message' })}
                    className={`${actionButton} hover:text-foreground`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={() => onResume(message.id)}
                      aria-label={t('input.schedule.resume', { defaultValue: 'Resume scheduled message' })}
                      title={t('input.schedule.resume', { defaultValue: 'Resume scheduled message' })}
                      className={`${actionButton} hover:text-foreground`}
                    >
                      <PlayIcon className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSendNow(message.id)}
                      disabled={!canSendNow}
                      aria-label={sendNowLabel}
                      title={sendNowLabel}
                      className={`${actionButton} hover:text-foreground`}
                    >
                      <SendIcon className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onCancel(message.id)}
                    aria-label={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
                    title={t('input.schedule.cancel', { defaultValue: 'Cancel scheduled message' })}
                    className={`${actionButton} hover:text-destructive`}
                  >
                    <XIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <span className="flex items-center gap-1 pr-1.5">
                  <StatusIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <span>{describeWhen(message, t)}</span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
