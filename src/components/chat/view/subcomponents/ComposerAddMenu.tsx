import { useCallback, useState, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ClockIcon, PaperclipIcon, PlusIcon } from 'lucide-react';

import { buttonVariants } from '../../../../shared/view/ui';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

import { ComposerMenuItem, ComposerMenuSurface } from './ComposerMenuPrimitives';

type ComposerAddMenuProps = {
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  attachLabel: string;
  canSchedule: boolean;
  onSchedule: () => void;
};

const HIDDEN_ANCHOR = { right: 0, bottom: 0, maxHeight: 0, maxWidth: 0 };

/**
 * The composer's + menu: attach files, or schedule the typed message.
 *
 * The real file input is stretched over the Attach row so it owns the tap —
 * Android standalone PWAs drop the result of a JS `input.click()`. The surface
 * stays mounted while closed so that input outlives the picker it opened.
 */
export default function ComposerAddMenu({
  getInputProps,
  attachLabel,
  canSchedule,
  onSchedule,
}: ComposerAddMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 14 * 16);
  const menuLabel = t('input.addMenu', { defaultValue: 'Add to message' });
  const scheduleLabel = t('input.schedule.menuItem', { defaultValue: 'Schedule message' });

  const inputProps = getInputProps({
    'aria-label': attachLabel,
    className: 'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0',
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      cursor: 'pointer',
    },
    tabIndex: 0,
    onClick: close,
  }) as InputHTMLAttributes<HTMLInputElement>;

  const isShown = isOpen && anchor !== null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="menu"
        aria-expanded={isShown}
        onClick={() => {
          if (isOpen) {
            close();
            return;
          }
          updateAnchor();
          setIsOpen(true);
        }}
        className={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          className: 'h-8 w-8 text-muted-foreground [&_svg]:size-5',
        })}
      >
        <PlusIcon aria-hidden="true" />
      </button>

      {typeof document !== 'undefined' && createPortal(
        <ComposerMenuSurface
          anchor={anchor ?? HIDDEN_ANCHOR}
          menuRef={menuRef}
          ariaLabel={menuLabel}
          className={isShown ? undefined : 'hidden'}
        >
          <div role="none" className="relative rounded-lg hover:bg-accent has-[:focus-visible]:bg-accent">
            <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-foreground/90">
              <PaperclipIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="leading-5">{attachLabel}</span>
            </div>
            <input {...inputProps} />
          </div>
          <ComposerMenuItem
            role="menuitem"
            isSelected={false}
            disabled={!canSchedule}
            icon={<ClockIcon className="h-4 w-4 text-muted-foreground" />}
            label={scheduleLabel}
            description={canSchedule
              ? undefined
              : t('input.schedule.needsText', { defaultValue: 'Type a message first' })}
            className="disabled:cursor-default"
            onSelect={() => {
              close();
              onSchedule();
            }}
          />
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
