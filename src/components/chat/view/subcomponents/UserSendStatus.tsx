import { useTranslation } from 'react-i18next';

import { requestIdFromMessageId, retrySend, useOutboxEntry } from '../../../../stores/sendOutbox';
import type { ChatMessage } from '../../types/types';

type UserSendStatusProps = {
  message: ChatMessage;
  /** The timestamp shown once the send is confirmed, or for any other user turn. */
  timeLabel: string;
  onEditUnsent?: (message: ChatMessage) => void;
};

/** The meta line under a user bubble: its send stage until the server confirms it, then the time. */
export default function UserSendStatus({ message, timeLabel, onEditUnsent }: UserSendStatusProps) {
  const { t } = useTranslation('chat');
  const requestId = requestIdFromMessageId(message.id);
  const entry = useOutboxEntry(requestId);

  if (!entry || !requestId || (entry.stage === 'sending' && !entry.slow)) {
    return <span>{timeLabel}</span>;
  }

  if (entry.stage === 'failed') {
    // A refusal from the server already shows as its own row; only a local failure needs its reason here.
    const reason = entry.frame ? null : entry.error;
    return (
      <span className="flex flex-wrap items-center justify-end gap-x-1" role="status">
        <span className="text-red-600 dark:text-red-400" title={reason ?? undefined}>
          {t('send.notSent')}
        </span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => retrySend(requestId)}
          className="rounded px-1 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
        >
          {t('send.retry')}
        </button>
        {onEditUnsent && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onEditUnsent(message)}
              className="rounded px-1 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('send.edit')}
            </button>
          </>
        )}
        {reason && <span className="basis-full text-right">{reason}</span>}
      </span>
    );
  }

  const imageCount = message.images?.length ?? 0;
  const fileCount = message.files?.length ?? 0;
  const label = entry.stage === 'uploading'
    ? fileCount === 0
      ? t('send.uploadingPhotos', { count: imageCount })
      : t('send.uploadingFiles', { count: imageCount + fileCount })
    : entry.stage === 'creating'
      ? t('send.creating')
      : entry.stage === 'waiting'
        ? t('send.waiting')
        : t('send.sending');

  return <span role="status">{label}</span>;
}
