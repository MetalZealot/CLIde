import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ClockIcon, PauseIcon, PencilIcon, PlayIcon, SendIcon, XIcon } from 'lucide-react';

import { formatClockTimeWithDay } from '../../../../utils/formatTime';
import type { ScheduledMessage } from '../../hooks/useScheduledMessages';

import UnsentMessageSheet, { type UnsentMessageAction } from './UnsentMessageSheet';

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

/** Unsent messages at the end of the thread, oldest first; a tap opens what can be done with one. */
export default function ScheduledMessageBubbles({
  messages,
  canSendNow,
  onSendNow,
  onEdit,
  onCancel,
  onResume,
}: ScheduledMessageBubblesProps) {
  const { t } = useTranslation('chat');
  const [openId, setOpenId] = useState<string | null>(null);
  // Looked up each render, so a message that sends or is cancelled elsewhere closes its sheet.
  const open = messages.find((message) => message.id === openId) ?? null;

  if (messages.length === 0) return null;

  const actionsFor = (message: ScheduledMessage): UnsentMessageAction[] => [
    message.state === 'paused'
      ? {
        key: 'resume',
        label: t('input.schedule.resumeAction', { defaultValue: 'Resume' }),
        icon: PlayIcon,
        onSelect: () => onResume(message.id),
      }
      : {
        key: 'send-now',
        label: t('input.schedule.sendNow', { defaultValue: 'Send now' }),
        icon: SendIcon,
        onSelect: () => onSendNow(message.id),
        disabled: !canSendNow,
        hint: canSendNow
          ? undefined
          : t('input.schedule.sendNowBusy', { defaultValue: 'Available once the current reply finishes' }),
      },
    {
      key: 'edit',
      label: t('input.schedule.editAction', { defaultValue: 'Edit' }),
      icon: PencilIcon,
      onSelect: () => onEdit(message),
    },
    {
      key: 'cancel',
      label: t('input.schedule.cancelAction', { defaultValue: 'Cancel message' }),
      icon: XIcon,
      onSelect: () => onCancel(message.id),
      isDanger: true,
    },
  ];

  return (
    <>
      {[...messages].reverse().map((message) => {
        const when = describeWhen(message, t);
        const attachmentCount = message.attachments?.length ?? 0;
        const StatusIcon = message.state === 'paused' ? PauseIcon : ClockIcon;
        return (
          <div key={message.id} className="chat-message flex justify-end px-1 sm:px-0">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpenId(message.id)}
              className="group flex max-w-[85%] flex-col items-end gap-1 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-md lg:max-w-lg xl:max-w-xl"
            >
              <span className="block max-w-full rounded-2xl border border-dashed border-blue-600/50 bg-blue-600/[0.08] px-3 py-2 text-foreground transition-colors group-hover:bg-blue-600/[0.14] dark:border-blue-400/50 dark:bg-blue-400/10 sm:px-4">
                <span dir="auto" className="chat-reading line-clamp-6 block whitespace-pre-wrap break-words">
                  {message.content}
                </span>
              </span>
              <span className="flex select-none items-center justify-end gap-1 px-1 text-xs text-muted-foreground">
                <StatusIcon className="h-3 w-3 shrink-0" aria-hidden />
                <span>{when}</span>
                {attachmentCount > 0 && (
                  <span>
                    · {t('input.schedule.attachmentCount', {
                      count: attachmentCount,
                      defaultValue: attachmentCount === 1 ? '{{count}} file' : '{{count}} files',
                    })}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}

      {open && (
        <UnsentMessageSheet
          content={open.content}
          status={describeWhen(open, t)}
          actions={actionsFor(open)}
          onDismiss={() => setOpenId(null)}
        />
      )}
    </>
  );
}
