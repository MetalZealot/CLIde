import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HistoryIcon, SearchIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { ChatMessage } from '../../types/types';
import { getTranscriptMessageUuid } from '../../utils/messageKeys';

type RewindPickerModalProps = {
  open: boolean;
  onClose: () => void;
  chatMessages: ChatMessage[];
  /** Enters rewind-edit mode for the picked message (beginRewindEdit). */
  onPickMessage: (message: ChatMessage) => void;
};

/**
 * The /rewind command's picker: lists the session's prior user messages
 * (newest first) and hands the picked one to the rewind-edit flow. Only
 * transcript-backed user text messages are offered — anything without a
 * uuid can't anchor a resume.
 */
export default function RewindPickerModal({ open, onClose, chatMessages, onPickMessage }: RewindPickerModalProps) {
  const { t } = useTranslation('chat');
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    return chatMessages
      .filter(
        (message) =>
          message.type === 'user' &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0 &&
          !message.isLocalCommand &&
          !message.isCompactSummary &&
          getTranscriptMessageUuid(message.id) !== null,
      )
      .reverse();
  }, [chatMessages]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return candidates;
    }
    return candidates.filter((message) => String(message.content).toLowerCase().includes(normalized));
  }, [candidates, query]);

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="flex max-h-[min(85dvh,36rem)] w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden rounded-3xl border-border/80 bg-popover p-0 shadow-2xl">
        <DialogTitle className="sr-only">
          {t('rewind.pickerTitle', { defaultValue: 'Rewind to an earlier message' })}
        </DialogTitle>

        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
            <HistoryIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('rewind.pickerEyebrow', { defaultValue: 'Rewind' })}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold tracking-tight text-foreground">
              {t('rewind.pickerTitle', { defaultValue: 'Rewind to an earlier message' })}
            </p>
          </div>
        </div>

        {candidates.length > 5 && (
          <div className="shrink-0 border-b border-border px-4 py-2 sm:px-5">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('rewind.pickerSearch', { defaultValue: 'Search your messages...' })}
                className="h-9 pl-8"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('rewind.pickerEmpty', { defaultValue: 'No earlier messages can be rewound to.' })}
            </p>
          ) : (
            visible.map((message) => (
              <button
                key={String(message.id)}
                type="button"
                onClick={() => {
                  onPickMessage(message);
                  handleClose();
                }}
                className="block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <p className="line-clamp-2 break-words text-sm text-foreground">{message.content}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(message.timestamp).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </button>
            ))
          )}
        </div>

        <p className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          {t('rewind.pickerHint', {
            defaultValue: 'Picking a message loads it into the composer; sending rewinds the conversation to that point.',
          })}
        </p>
      </DialogContent>
    </Dialog>
  );
}
