import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useHeaderSheetHost } from '../../../../contexts/HeaderSheetContext';
import { PageScrollLock, useCloseOnBack } from '../../../../shared/view/ui';
import { SHEET_CLOSE_MS, SHEET_EASE, useSheetDrag } from '../../../../shared/view/ui/useSheetDrag';

/**
 * The header controls' sheet on phones: it slides out from behind the header,
 * covering the bar beneath it, and closes on a drag up, a tap outside, Escape,
 * or back. The header stays above it, so its controls toggle and swap the sheet.
 */
export default function HeaderSheet({ anchorRef, enabled }: { anchorRef: RefObject<HTMLElement | null>; enabled: boolean }) {
  const host = useHeaderSheetHost();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(0);
  const active = host?.active ?? null;
  const open = enabled && Boolean(active);
  const hostClose = host?.close;
  const close = useCallback(() => hostClose?.(), [hostClose]);
  const setEnabled = host?.setEnabled;
  const finishClose = host?.finishClose;
  const setBody = host?.setBody;
  // Stable, or each render would hand the owners a null body and back.
  const attachBody = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    setBody?.(element);
  }, [setBody]);

  useEffect(() => {
    if (!setEnabled) return undefined;
    setEnabled(enabled);
    return () => setEnabled(false);
  }, [enabled, setEnabled]);

  // Widened past the phone breakpoint while open: the owners fall back to popovers, closed.
  useEffect(() => {
    if (!enabled && active) finishClose?.();
  }, [enabled, active, finishClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => setTop(anchorRef.current?.getBoundingClientRect().bottom ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchorRef]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [active?.key]);

  useEffect(() => {
    if (!host?.closing) return undefined;
    const sheet = sheetRef.current;
    if (!sheet) {
      finishClose?.();
      return undefined;
    }
    const transition = `${SHEET_CLOSE_MS}ms ${SHEET_EASE}`;
    sheet.style.transition = `translate ${transition}`;
    sheet.style.translate = '0 -100%';
    if (overlayRef.current) {
      overlayRef.current.style.transition = `opacity ${transition}`;
      overlayRef.current.style.opacity = '0';
    }
    const timer = window.setTimeout(() => finishClose?.(), SHEET_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [host?.closing, finishClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  useCloseOnBack(open, close);
  useSheetDrag(sheetRef, overlayRef, open, close, 'top');

  if (!open || !host) return null;

  return createPortal(
    // Clipped at the header's bottom edge, so the sheet appears from behind it.
    <div className="fixed inset-x-0 bottom-0 z-40 overflow-hidden" style={{ top }}>
      <PageScrollLock />
      <div
        ref={overlayRef}
        className="absolute inset-0 animate-dialog-overlay-show touch-none bg-black/25"
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={active?.label}
        className="absolute inset-x-0 top-0 mx-auto flex max-h-[calc(100%-3rem)] w-full max-w-2xl animate-sheet-down flex-col overflow-hidden rounded-b-3xl border border-t-0 border-border/80 bg-popover shadow-2xl"
      >
        <div
          ref={attachBody}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        />
        <div className="flex shrink-0 justify-center pb-2.5 pt-1.5" aria-hidden="true">
          <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
