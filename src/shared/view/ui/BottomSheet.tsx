import * as React from 'react';

import { cn } from '../../../lib/utils';

import ContextMenuOverlay, { anchorFromElement } from './ContextMenuOverlay';
import { Dialog, DialogContent, DialogTitle, FOCUSABLE_SELECTOR } from './Dialog';
import { useCloseOnBack } from './useCloseOnBack';
import { useSheetAsPopover } from './useSheetAsPopover';
import { SHEET_CLOSE_MS, SHEET_EASE, useSheetDrag } from './useSheetDrag';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Read by screen readers only. */
  title: string;
  className?: string;
  /** Wider than a phone, the sheet becomes a popover hanging from this element, when it returns one. */
  anchor?: () => Element | null;
  /** Classes for the popover box, usually its width. */
  popoverClassName?: string;
  /** Popover as wide as its anchor. */
  matchAnchorWidth?: boolean;
  /** `auto` for an anchor near the top of the screen. */
  popoverPlacement?: 'auto' | 'above';
  children: React.ReactNode;
};

const POPOVER_MAX_HEIGHT_RATIO = 0.7;

/**
 * A sheet that rises from the bottom edge. It closes on a drag down, a tap
 * outside, Escape, or the back gesture, and slides away on each.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  className,
  anchor,
  popoverClassName,
  matchAnchorWidth = false,
  popoverPlacement = 'above',
  children,
}: BottomSheetProps) {
  const asPopover = useSheetAsPopover();
  // Read during render: the anchor belongs to another component and is already mounted.
  const anchorElement = open && asPopover ? anchor?.() ?? null : null;
  const isPopover = Boolean(anchorElement);
  const popoverBodyRef = React.useRef<HTMLDivElement | null>(null);
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

  useCloseOnBack(open && !anchorElement, requestClose);
  useSheetDrag(sheetRef, overlayRef, open && !anchorElement, requestClose);

  // Focus moves in so Escape reaches the popover (a terminal would swallow it), and back on close.
  React.useEffect(() => {
    if (!isPopover) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const body = popoverBodyRef.current;
      if (body && !body.contains(document.activeElement)) body.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [isPopover]);

  if (anchorElement) {
    return (
      <ContextMenuOverlay
        role="dialog"
        ariaLabel={title}
        anchor={anchorFromElement(anchorElement, { x: 0, y: 0 })}
        anchorElement={anchorElement}
        placement={popoverPlacement}
        maxHeight={Math.round(window.innerHeight * POPOVER_MAX_HEIGHT_RATIO)}
        onDismiss={onClose}
        style={matchAnchorWidth ? { width: anchorElement.getBoundingClientRect().width } : undefined}
        className={cn('flex max-w-[calc(100vw-20px)] select-text flex-col overflow-hidden rounded-xl pt-1 shadow-2xl', popoverClassName)}
      >
        <div ref={popoverBodyRef} className="contents">{children}</div>
      </ContextMenuOverlay>
    );
  }

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
