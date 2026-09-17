import ReactDOM from 'react-dom';
import { AlertTriangle, EyeOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, PageScrollLock } from '../../../../shared/view/ui';

type SessionDeleteDialogProps = {
  sessionTitle: string;
  /** An archived session is offered only permanent deletion. */
  isArchived: boolean;
  onConfirm: (hardDelete: boolean) => void;
  onCancel: () => void;
};

/** Confirms deleting one session, offering Archive as the recoverable alternative. */
export default function SessionDeleteDialog({ sessionTitle, isArchived, onConfirm, onCancel }: SessionDeleteDialogProps) {
  const { t } = useTranslation(['sidebar', 'common']);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <PageScrollLock />
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {t('deleteConfirmation.deleteSession')}
              </h3>
              <p className="mb-1 text-sm text-muted-foreground">
                {t('deleteConfirmation.confirmDelete')}{' '}
                <span className="font-medium text-foreground">
                  {sessionTitle || t('sessions.unnamed')}
                </span>
                ?
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {isArchived
                  ? t('deleteConfirmation.archivedSessionNotice', 'This session is already archived. You can keep it hidden or delete it permanently.')
                  : t('deleteConfirmation.archiveSessionNotice', 'Archive keeps the session out of the active list while preserving its history.')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
          {!isArchived && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => onConfirm(false)}
            >
              <EyeOff className="mr-2 h-4 w-4" />
              {t('deleteConfirmation.archiveSession', 'Archive session')}
            </Button>
          )}
          <Button
            variant="destructive"
            className="w-full justify-start bg-red-600 text-white hover:bg-red-700"
            onClick={() => onConfirm(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('deleteConfirmation.deleteSessionPermanently', 'Delete permanently')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
