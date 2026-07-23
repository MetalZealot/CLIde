import { useTranslation } from 'react-i18next';
import { HistoryIcon, XIcon } from 'lucide-react';

interface RewindEditCardProps {
  /** Preview of the original message being edited. */
  snippet: string;
  onCancel: () => void;
}

/**
 * Composer banner shown while a prior user message is being edited: sending
 * will rewind the conversation to that point and continue from the edited
 * text. Mirrors QueuedMessageCard's chrome so the two "armed composer"
 * states read as one family.
 */
export default function RewindEditCard({ snippet, onCancel }: RewindEditCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <HistoryIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <span>{t('input.rewind.label', { defaultValue: 'Editing earlier message' })}</span>
            <span className="normal-case text-muted-foreground/60">
              · {t('input.rewind.willRewind', { defaultValue: 'Sending rewinds the conversation to this point' })}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-foreground/90">{snippet}</p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label={t('input.rewind.cancel', { defaultValue: 'Cancel rewind edit' })}
          title={t('input.rewind.cancel', { defaultValue: 'Cancel rewind edit' })}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
