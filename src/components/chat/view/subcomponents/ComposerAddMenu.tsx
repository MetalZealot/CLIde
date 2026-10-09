import { useCallback, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CameraIcon, ImageIcon, PaperclipIcon, PlusIcon, TimerIcon } from 'lucide-react';

import { buttonVariants } from '../../../../shared/view/ui';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

import { ComposerMenuItem, ComposerMenuSurface } from './ComposerMenuPrimitives';

type ComposerAddMenuProps = {
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  attachLabel: string;
  onAttachFiles: (files: File[]) => void;
  canSchedule: boolean;
  onSchedule: () => void;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<Array<{ getFile: () => Promise<File> }>>;
};

const HIDDEN_ANCHOR = { right: 0, bottom: 0, maxHeight: 0, maxWidth: 0 };

const OVERLAY_INPUT_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
} as const;
const OVERLAY_INPUT_CLASS = 'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0';

function OverlayInputRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div role="none" className="relative rounded-lg hover:bg-accent has-[:focus-visible]:bg-accent">
      <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-foreground/90">
        {icon}
        <span className="leading-5">{label}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The composer's + menu: take a photo, pick photos, attach files, or schedule a message.
 *
 * Camera and Photos click hidden inputs outside the menu: `capture` opens the camera
 * app, and an image-only `accept` opens Android's photo grid, whose files read only if
 * nothing asks their size first (ADR 0075). Camera is offered only on touch screens,
 * where desktop would get a file dialog.
 *
 * Attach files uses `showOpenFilePicker` where it exists: on Android it opens the
 * file browser with every type selectable, where a file input with any `accept`
 * that admits images detours through a camera chooser. Elsewhere a real file input
 * is stretched over the row so it owns the tap, and the surface stays mounted while
 * closed so that input outlives the picker it opened.
 */
export default function ComposerAddMenu({
  getInputProps,
  attachLabel,
  onAttachFiles,
  canSchedule,
  onSchedule,
}: ComposerAddMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 14 * 16);
  const menuLabel = t('input.addMenu', { defaultValue: 'Add to message' });
  const scheduleLabel = t('input.schedule.menuItem', { defaultValue: 'Scheduled Message' });
  const cameraLabel = t('input.camera', { defaultValue: 'Camera' });
  const hasCamera = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const photosLabel = t('input.photos', { defaultValue: 'Photos' });
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onAttachFiles(files);
    event.target.value = '';
  };
  const showOpenFilePicker = typeof window === 'undefined'
    ? undefined
    : (window as FilePickerWindow).showOpenFilePicker?.bind(window);

  const inputProps = getInputProps({
    'aria-label': attachLabel,
    className: OVERLAY_INPUT_CLASS,
    style: OVERLAY_INPUT_STYLE,
    tabIndex: 0,
    onClick: close,
  }) as InputHTMLAttributes<HTMLInputElement>;

  const pickFiles = () => {
    close();
    // Called synchronously from the tap: the picker needs that user activation.
    showOpenFilePicker?.({ multiple: true })
      .then((handles) => Promise.all(handles.map((handle) => handle.getFile())))
      .then((files) => {
        if (files.length > 0) onAttachFiles(files);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.error('File picker failed:', error);
        }
      });
  };

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
      {hasCamera && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={cameraLabel}
          className="hidden"
          onChange={handlePicked}
        />
      )}
      <input
        ref={photosInputRef}
        type="file"
        accept="image/*"
        multiple
        aria-label={photosLabel}
        className="hidden"
        onChange={handlePicked}
      />

      {typeof document !== 'undefined' && createPortal(
        <ComposerMenuSurface
          anchor={anchor ?? HIDDEN_ANCHOR}
          menuRef={menuRef}
          ariaLabel={menuLabel}
          className={isShown ? undefined : 'hidden'}
        >
          {hasCamera && (
            <ComposerMenuItem
              role="menuitem"
              isSelected={false}
              icon={<CameraIcon className="h-4 w-4 text-muted-foreground" />}
              label={cameraLabel}
              onSelect={() => {
                close();
                cameraInputRef.current?.click();
              }}
            />
          )}
          <ComposerMenuItem
            role="menuitem"
            isSelected={false}
            icon={<ImageIcon className="h-4 w-4 text-muted-foreground" />}
            label={photosLabel}
            onSelect={() => {
              close();
              photosInputRef.current?.click();
            }}
          />
          {showOpenFilePicker ? (
            <ComposerMenuItem
              role="menuitem"
              isSelected={false}
              icon={<PaperclipIcon className="h-4 w-4 text-muted-foreground" />}
              label={attachLabel}
              onSelect={pickFiles}
            />
          ) : (
            <OverlayInputRow
              icon={<PaperclipIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label={attachLabel}
            >
              <input {...inputProps} />
            </OverlayInputRow>
          )}
          <ComposerMenuItem
            role="menuitem"
            isSelected={false}
            disabled={!canSchedule}
            icon={<TimerIcon className="h-4 w-4 text-muted-foreground" />}
            label={scheduleLabel}
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
