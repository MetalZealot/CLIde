import * as React from 'react';

import { cn } from '../../../lib/utils';

import { Dialog, DialogContent, DialogTitle } from './Dialog';

/** Release past this share of the sheet's height closes it. */
const DISMISS_FRACTION = 1 / 3;
/** A downward release faster than this closes it from any distance. */
const FLICK_PX_PER_MS = 0.5;
const SLOP_PX = 6;
const CLOSE_MS = 200;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const BACK_MARKER = '__clideSheet';

function sheetReleaseCloses(offset: number, height: number, velocity: number): boolean {
  return offset > height * DISMISS_FRACTION || (velocity > FLICK_PX_PER_MS && offset > 12);
}

/** The nearest element between `target` and `root` that scrolls vertically. */
function findScroller(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  for (let el = target as HTMLElement | null; el && el !== root.parentElement; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
      return el;
    }
  }
  return null;
}

/**
 * One history entry while open, so Android's back gesture closes the sheet
 * instead of leaving the page. Closing any other way drops the entry, unless a
 * navigation has since covered it.
 */
function useCloseOnBack(open: boolean, onBack: () => void) {
  const openRef = React.useRef(open);
  openRef.current = open;
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  React.useEffect(() => {
    if (!open) return undefined;
    if (!window.history.state?.[BACK_MARKER]) {
      window.history.pushState({ [BACK_MARKER]: true }, '');
    }
    let popped = false;
    const handlePopState = () => {
      popped = true;
      onBackRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Deferred so StrictMode's remount keeps the entry it would otherwise pop.
      window.setTimeout(() => {
        if (!popped && !openRef.current && window.history.state?.[BACK_MARKER]) {
          window.history.back();
        }
      }, 0);
    };
  }, [open]);
}

type Gesture = {
  startX: number;
  startY: number;
  lastY: number;
  samples: Array<[number, number]>;
  scroller: HTMLElement | null;
  canDrag: boolean;
  state: 'pending' | 'drag' | 'scroll' | 'sideways';
  base: number;
  offset: number;
  height: number;
};

/**
 * Drag down anywhere to close once the content under the finger is at its top.
 * A swipe that scrolls content back to the top carries on into the sheet, and
 * dragging the sheet back to rest hands the swipe back to the content.
 */
function useSheetDrag(
  sheetRef: React.RefObject<HTMLDivElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  React.useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) return undefined;

    let g: Gesture | null = null;
    let frozen: { el: HTMLElement; overflowY: string } | null = null;

    // A scroll already under way cannot be cancelled, so the content is frozen while the sheet moves.
    const freeze = (el: HTMLElement | null) => {
      if (!el || frozen) return;
      frozen = { el, overflowY: el.style.overflowY };
      el.style.overflowY = 'hidden';
    };
    const thaw = () => {
      if (!frozen) return;
      frozen.el.style.overflowY = frozen.overflowY;
      frozen = null;
    };
    const setOffset = (px: number, height: number, animate: boolean) => {
      const transition = animate ? `${CLOSE_MS}ms ${EASE}` : 'none';
      sheet.style.transition = animate ? `translate ${transition}` : 'none';
      sheet.style.translate = px ? `0 ${px}px` : '';
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.transition = animate ? `opacity ${transition}` : 'none';
        overlay.style.opacity = px ? String(Math.max(0, 1 - px / height)) : '';
      }
    };
    const startDrag = (gesture: Gesture, base: number) => {
      gesture.state = 'drag';
      gesture.base = base;
      freeze(gesture.scroller);
      if (document.activeElement instanceof HTMLElement && sheet.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        g = null;
        return;
      }
      const touch = event.touches[0];
      const scroller = findScroller(event.target, sheet);
      g = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        samples: [[event.timeStamp, touch.clientY]],
        scroller,
        canDrag: !scroller || scroller.scrollTop <= 0,
        state: 'pending',
        base: touch.clientY,
        offset: 0,
        height: sheet.offsetHeight,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!g) return;
      const touch = event.touches[0];
      const y = touch.clientY;
      g.samples.push([event.timeStamp, y]);
      if (g.samples.length > 6) g.samples.shift();

      if (g.state === 'pending') {
        const dx = touch.clientX - g.startX;
        const dy = y - g.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) {
          g.lastY = y;
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) g.state = 'sideways';
        else if (dy > 0 && g.canDrag) startDrag(g, g.startY + SLOP_PX);
        else g.state = 'scroll';
      }
      const movingUp = y < g.lastY;
      if (g.state === 'scroll' && y > g.lastY && g.scroller && g.scroller.scrollTop <= 0) {
        startDrag(g, y);
      }
      g.lastY = y;
      if (g.state !== 'drag') return;

      if (event.cancelable) event.preventDefault();
      g.offset = Math.max(0, y - g.base);
      setOffset(g.offset, g.height, false);
      if (g.offset === 0 && movingUp) {
        g.state = 'scroll';
        thaw();
      }
    };

    const handleTouchEnd = () => {
      const done = g;
      g = null;
      thaw();
      if (!done || done.state !== 'drag') return;
      const [t0, y0] = done.samples[0];
      const [t1, y1] = done.samples[done.samples.length - 1];
      const velocity = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0;
      if (sheetReleaseCloses(done.offset, done.height, velocity)) onDismissRef.current();
      else setOffset(0, done.height, true);
    };

    sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    sheet.addEventListener('touchend', handleTouchEnd);
    sheet.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      thaw();
      sheet.removeEventListener('touchstart', handleTouchStart);
      sheet.removeEventListener('touchmove', handleTouchMove);
      sheet.removeEventListener('touchend', handleTouchEnd);
      sheet.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [open, sheetRef, overlayRef]);
}

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
    const transition = `${CLOSE_MS}ms ${EASE}`;
    sheet.style.transition = `translate ${transition}`;
    sheet.style.translate = '0 100%';
    if (overlayRef.current) {
      overlayRef.current.style.transition = `opacity ${transition}`;
      overlayRef.current.style.opacity = '0';
    }
    window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
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
