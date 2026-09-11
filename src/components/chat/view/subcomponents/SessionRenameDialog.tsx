import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';

type SessionRenameDialogProps = {
  /** The name the field opens with; null keeps the dialog closed. */
  initialName: string | null;
  onClose: () => void;
  /** Resolves once the rename settles; the dialog stays open until then. */
  onSubmit: (name: string) => Promise<void>;
};

export default function SessionRenameDialog({ initialName, onClose, onSubmit }: SessionRenameDialogProps) {
  const { t } = useTranslation('sidebar');
  const titleId = useId();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isOpen = initialName !== null;

  useEffect(() => {
    if (initialName !== null) {
      setName(initialName);
    }
  }, [initialName]);

  const trimmed = name.trim();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || isSaving) {
      return;
    }
    if (trimmed === initialName?.trim()) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => !nextOpen && !isSaving && onClose()}>
      <DialogContent aria-labelledby={titleId} className="w-[calc(100vw-2rem)] max-w-sm p-5">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogTitle id={titleId} className="not-sr-only mb-4 text-base font-semibold text-foreground">
            {t('sessions.renameSession')}
          </DialogTitle>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('sessions.renameSession')}
            readOnly={isSaving}
            className="h-11 text-base md:h-9 md:text-sm"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!trimmed || isSaving}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
