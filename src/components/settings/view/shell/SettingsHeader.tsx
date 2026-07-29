import { ChevronLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';

type SettingsHeaderProps = {
  title: string;
  /** Label for the back target; absent at depth 0 and on desktop. */
  backLabel?: string | null;
  onBack?: () => void;
  onClose: () => void;
  showSavedIndicator: boolean;
};

/**
 * One header element across all depths and both form factors: title plus close,
 * gaining a back chevron once there is somewhere to go back to.
 *
 * The "Saved" indicator is still here rather than local to each row, as the
 * spec's save model calls for. It is currently the only feedback for provider
 * login and for the permissions/notifications autosave, and those screens do
 * not gain local confirmation until P3a and P4 — removing it now would drop
 * that feedback with nothing in its place. It goes when they land.
 */
export default function SettingsHeader({
  title,
  backLabel,
  onBack,
  onClose,
  showSavedIndicator,
}: SettingsHeaderProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-2 py-3 md:px-5">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label={t('nav.back')}
          className="h-10 flex-shrink-0 touch-manipulation gap-1 px-2 text-muted-foreground hover:text-foreground active:bg-accent/50"
        >
          <ChevronLeft className="h-5 w-5" />
          {backLabel && <span className="max-w-32 truncate text-sm">{backLabel}</span>}
        </Button>
      )}

      <h2 className="min-w-0 flex-1 truncate px-2 text-base font-semibold text-foreground">
        {title}
      </h2>

      <div className="flex flex-shrink-0 items-center gap-2">
        {showSavedIndicator && (
          <span className="animate-in fade-in text-xs text-muted-foreground">
            {t('saveStatus.success')}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={t('nav.close')}
          className="h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
