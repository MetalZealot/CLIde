import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

import { PageScrollLock } from '../../../../shared/view/ui';

export type UnsentMessageAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Says why, when the action is disabled. */
  hint?: string;
  disabled?: boolean;
  isDanger?: boolean;
};

interface UnsentMessageSheetProps {
  content: string;
  status: string;
  actions: UnsentMessageAction[];
  onDismiss: () => void;
}

/** A sheet in a portal, like the schedule menu, so a closing keyboard cannot reflow it away. */
export default function UnsentMessageSheet({ content, status, actions, onDismiss }: UnsentMessageSheetProps) {
  const { t } = useTranslation('chat');
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => opener?.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <PageScrollLock />
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={status}
        className="settings-content-enter relative mx-auto w-full max-w-md rounded-t-2xl border border-border bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg"
      >
        <div className="px-2 pb-2">
          <p className="text-xs text-muted-foreground">{status}</p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">{content}</p>
        </div>
        <div className="mb-1 h-px bg-border" />

        {actions.map(({ key, label, icon: Icon, onSelect, hint, disabled, isDanger }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => {
              onDismiss();
              onSelect();
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 ${
              isDanger ? 'text-destructive' : ''
            }`}
          >
            <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block">{label}</span>
              {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
