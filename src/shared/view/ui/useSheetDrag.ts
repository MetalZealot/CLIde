import * as React from 'react';

/** Release past this share of the sheet's height closes it. */
const DISMISS_FRACTION = 1 / 3;
/** A release toward the edge faster than this closes it from any distance. */
const FLICK_PX_PER_MS = 0.5;
const SLOP_PX = 6;
export const SHEET_CLOSE_MS = 200;
export const SHEET_EASE = 'cubic-bezier(.2,.8,.2,1)';

/** The screen edge a sheet is attached to; it closes by moving toward it. */
export type SheetEdge = 'top' | 'bottom';

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

/** Whether the content can scroll no further toward the sheet's edge. */
function atEdgeEnd(scroller: HTMLElement, edge: SheetEdge): boolean {
  return edge === 'bottom'
    ? scroller.scrollTop <= 0
    : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
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
 * Drag toward the sheet's edge anywhere to close once the content under the
 * finger can scroll no further that way. A swipe that scrolls content to its
 * end carries on into the sheet, and dragging the sheet back to rest hands the
 * swipe back to the content.
 */
export function useSheetDrag(
  sheetRef: React.RefObject<HTMLDivElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  onDismiss: () => void,
  edge: SheetEdge = 'bottom',
) {
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  React.useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) return undefined;
    // +1 when closing moves down the screen, -1 when it moves up.
    const dir = edge === 'bottom' ? 1 : -1;

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
      const transition = animate ? `${SHEET_CLOSE_MS}ms ${SHEET_EASE}` : 'none';
      sheet.style.transition = animate ? `translate ${transition}` : 'none';
      sheet.style.translate = px ? `0 ${px * dir}px` : '';
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
      // A finger in a text field is selecting or placing the caret.
      if (event.touches.length !== 1 || (edge === 'top' && (event.target as Element).closest?.('input, textarea'))) {
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
        canDrag: !scroller || atEdgeEnd(scroller, edge),
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
        else if (dy * dir > 0 && g.canDrag) startDrag(g, g.startY + SLOP_PX * dir);
        else g.state = 'scroll';
      }
      const step = (y - g.lastY) * dir;
      if (g.state === 'scroll' && step > 0 && g.scroller && atEdgeEnd(g.scroller, edge)) {
        startDrag(g, y);
      }
      g.lastY = y;
      if (g.state !== 'drag') return;

      if (event.cancelable) event.preventDefault();
      g.offset = Math.max(0, (y - g.base) * dir);
      setOffset(g.offset, g.height, false);
      if (g.offset === 0 && step < 0) {
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
      const velocity = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * dir : 0;
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
  }, [open, sheetRef, overlayRef, edge]);
}
