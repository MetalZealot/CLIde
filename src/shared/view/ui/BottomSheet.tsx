import * as React from 'react';

import { cn } from '../../../lib/utils';

import { Dialog, DialogContent, DialogTitle } from './Dialog';
import { useCloseOnBack } from './useCloseOnBack';
import { SHEET_CLOSE_MS, SHEET_EASE, useSheetDrag } from './useSheetDrag';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Read by screen readers only. */
  title: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * A sheet that rises from the bottom edge. It closes on a drag down, a tap
 * outside, Escape, or the back gesture, and slides away on each.
 */
export default function BottomSheet({ open, onClose, title, className, children }: BottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const closingRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (open) closingRef.current = false;
  }, [open]);

  const requestClose = React.useCallback(() => {
    const sheet = sheetRef.current;
    if (closingRef.current) return;
    closingRef.current = true;
    if (!sheet) {
      onCloseRef.current();
      return;
    }
    const transition = `${SHEET_CLOSE_MS}ms ${SHEET_EASE}`;
    sheet.style.transition = `translate ${transition}`;
    sheet.style.translate = '0 100%';
    if (overlayRef.current) {
      overlayRef.current.style.transition = `opacity ${transition}`;
      overlayRef.current.style.opacity = '0';
    }
    window.setTimeout(() => onCloseRef.current(), SHEET_CLOSE_MS);
  }, []);

  useCloseOnBack(open, requestClose);
  useSheetDrag(sheetRef, overlayRef, open, requestClose);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <DialogContent
        ref={sheetRef}
        overlayRef={overlayRef}
        className={cn(
          'bottom-0 left-0 right-0 top-auto mx-auto flex max-h-[80dvh] w-full max-w-2xl translate-x-0 translate-y-0 flex-col overflow-hidden',
          'animate-sheet-up rounded-b-none rounded-t-3xl border-border/80 bg-popover p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl',
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex shrink-0 justify-center pt-2" aria-hidden>
          <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
