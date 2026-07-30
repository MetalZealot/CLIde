import { ChevronLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';

type SettingsHeaderProps = {
  title: string;
  /** Label for the back target; absent at depth 0 and on desktop. */
  backLabel?: string | null;
  onBack?: () => void;
  onClose: () => void;
};

/**
 * One header element across all depths and both form factors: title plus close,
 * gaining a back chevron once there is somewhere to go back to.
 *
 * The global "Saved" indicator that used to live here is gone as of P4, per the
 * IA spec's save model: confirmation is local to the thing that changed. Its two
 * triggers were provider login — now confirmed on the provider screen itself —
 * and the permissions/notifications autosave, where the control's own state is
 * the confirmation.
 */
export default function SettingsHeader({
  title,
  backLabel,
  onBack,
  onClose,
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
