import { useTranslation } from 'react-i18next';
import { HistoryIcon, XIcon } from 'lucide-react';

interface RewindEditCardProps {
  onCancel: () => void;
}

/** Composer status while editing an earlier message. */
export default function RewindEditCard({ onCancel }: RewindEditCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto mb-2 flex max-w-[54.25rem] items-center gap-2.5 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-3 py-1.5">
      <HistoryIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-medium text-amber-700 dark:text-amber-300">
        {t('input.rewind.label', { defaultValue: 'Editing earlier message' })}
      </span>
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
  );
}
