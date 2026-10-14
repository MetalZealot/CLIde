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

/**
 * Scrim handlers: a touch that starts on the scrim dismisses on lift, swiped or
 * not. A swipe fires no click, and cancelling touchend stops the tap's click
 * landing on whatever sits under the scrim once it unmounts.
 */
export function useScrimDismiss(onDismiss: () => void) {
  const touchStartedRef = React.useRef(false);
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;
  return React.useMemo(() => ({
    onTouchStart: (event: React.TouchEvent) => {
      touchStartedRef.current = event.touches.length === 1 && event.target === event.currentTarget;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (!touchStartedRef.current) return;
      touchStartedRef.current = false;
      if (event.cancelable) event.preventDefault();
      onDismissRef.current();
    },
    onTouchCancel: () => {
      touchStartedRef.current = false;
    },
    onClick: () => onDismissRef.current(),
  }), []);
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

/** Heights an expandable sheet rests at. `null` is its content's own height. */
export type SheetDetent = 'half' | 'full';

/** Share of the screen an expandable sheet opens to. */
const HALF_RATIO = 0.5;

/** Its class's max-height: the screen less the status bar. */
function fullHeight(sheet: HTMLElement): number {
  return parseFloat(getComputedStyle(sheet).maxHeight) || window.innerHeight;
}

function detentHeight(sheet: HTMLElement, detent: SheetDetent): number {
  const full = fullHeight(sheet);
  return detent === 'full' ? full : Math.min(full, Math.round(window.innerHeight * HALF_RATIO));
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
  /** Visible height when this drag began. */
  rest: number;
  /** Visible height now. */
  visible: number;
  /** Heights it can settle at, lowest first; below the lowest it is closing. */
  stops: number[];
};

export type SheetDragControls = {
  /** Size an expandable sheet; `null` returns it to its content's height. */
  setDetent: (detent: SheetDetent | null, animate: boolean) => void;
  toggleDetent: () => void;
  /** Where an expandable sheet rests now. */
  detent: SheetDetent | null;
};

/**
 * Drag toward the sheet's edge anywhere to close once the content under the
 * finger can scroll no further that way. A swipe that scrolls content to its
 * end carries on into the sheet, and dragging the sheet back to rest hands the
 * swipe back to the content. An expandable sheet rests at half or full height:
 * at half, a drag away from the edge grows it before any content scrolls.
 */
export function useSheetDrag(
  sheetRef: React.RefObject<HTMLDivElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  onDismiss: () => void,
  edge: SheetEdge = 'bottom',
): SheetDragControls {
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const detentRef = React.useRef<SheetDetent | null>(null);
  const [detent, setDetentState] = React.useState<SheetDetent | null>(null);
  const commit = React.useCallback((next: SheetDetent | null) => {
    detentRef.current = next;
    setDetentState(next);
  }, []);
  // +1 when closing moves down the screen, -1 when it moves up.
  const dir = edge === 'bottom' ? 1 : -1;

  // Grows by height above `floor`, slides off by translate below it.
  const paint = React.useCallback((visible: number, floor: number, animate: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const transition = `${SHEET_CLOSE_MS}ms ${SHEET_EASE}`;
    sheet.style.transition = animate ? `translate ${transition}, height ${transition}` : 'none';
    if (detentRef.current) sheet.style.height = `${Math.max(visible, floor)}px`;
    const offset = Math.max(0, floor - visible);
    sheet.style.translate = offset ? `0 ${offset * dir}px` : '';
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transition = animate ? `opacity ${transition}` : 'none';
      overlay.style.opacity = offset ? String(Math.max(0, visible / floor)) : '';
    }
  }, [sheetRef, overlayRef, dir]);

  const setDetent = React.useCallback((detent: SheetDetent | null, animate: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (detent) {
      commit(detent);
      paint(detentHeight(sheet, detent), detentHeight(sheet, 'half'), animate);
      return;
    }
    if (!detentRef.current) return;
    commit(null);
    // Height cannot transition to auto, so it runs to the measured content height, then lets go.
    const from = sheet.offsetHeight;
    sheet.style.height = '';
    const to = sheet.offsetHeight;
    if (!animate || from === to) return;
    sheet.style.transition = 'none';
    sheet.style.height = `${from}px`;
    void sheet.offsetHeight;
    sheet.style.transition = `height ${SHEET_CLOSE_MS}ms ${SHEET_EASE}`;
    sheet.style.height = `${to}px`;
    window.setTimeout(() => {
      if (!detentRef.current) sheet.style.height = '';
    }, SHEET_CLOSE_MS);
  }, [sheetRef, paint, commit]);

  const toggleDetent = React.useCallback(() => {
    if (detentRef.current) setDetent(detentRef.current === 'full' ? 'half' : 'full', true);
  }, [setDetent]);

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
    const startDrag = (gesture: Gesture, base: number) => {
      gesture.state = 'drag';
      gesture.base = base;
      gesture.rest = gesture.visible;
      freeze(gesture.scroller);
      if (document.activeElement instanceof HTMLElement && sheet.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    };
    const stopsNow = (): number[] => (detentRef.current
      ? [detentHeight(sheet, 'half'), detentHeight(sheet, 'full')]
      : [sheet.offsetHeight]);

    const handleTouchStart = (event: TouchEvent) => {
      // A finger in a text field is selecting or placing the caret.
      if (event.touches.length !== 1 || (edge === 'top' && (event.target as Element).closest?.('input, textarea'))) {
        g = null;
        return;
      }
      const touch = event.touches[0];
      const scroller = findScroller(event.target, sheet);
      const stops = stopsNow();
      const visible = detentRef.current ? detentHeight(sheet, detentRef.current) : stops[0];
      g = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        samples: [[event.timeStamp, touch.clientY]],
        scroller,
        canDrag: !scroller || atEdgeEnd(scroller, edge),
        state: 'pending',
        base: touch.clientY,
        rest: visible,
        visible,
        stops,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!g) return;
      const touch = event.touches[0];
      const y = touch.clientY;
      g.samples.push([event.timeStamp, y]);
      if (g.samples.length > 6) g.samples.shift();
      const top = g.stops[g.stops.length - 1];

      if (g.state === 'pending') {
        const dx = touch.clientX - g.startX;
        const dy = y - g.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) {
          g.lastY = y;
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) g.state = 'sideways';
        else if (dy * dir > 0 && g.canDrag) startDrag(g, g.startY + SLOP_PX * dir);
        else if (dy * dir < 0 && g.visible < top) startDrag(g, g.startY - SLOP_PX * dir);
        else g.state = 'scroll';
      }
      const step = (y - g.lastY) * dir;
      if (g.state === 'scroll' && step > 0 && g.scroller && atEdgeEnd(g.scroller, edge)) {
        startDrag(g, y);
      }
      g.lastY = y;
      if (g.state !== 'drag') return;

      if (event.cancelable) event.preventDefault();
      g.visible = Math.min(top, Math.max(0, g.rest - (y - g.base) * dir));
      paint(g.visible, g.stops[0], false);
      if (g.visible >= top && step < 0) {
        if (detentRef.current) commit('full');
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
      const { stops, visible } = done;
      const floor = stops[0];
      let target: number | null;
      if (velocity > FLICK_PX_PER_MS) {
        target = [...stops].reverse().find((stop) => stop <= visible - 12) ?? (visible < floor - 12 ? null : floor);
      } else if (velocity < -FLICK_PX_PER_MS) {
        target = stops.find((stop) => stop >= visible + 12) ?? stops[stops.length - 1];
      } else if (visible < floor * (1 - DISMISS_FRACTION)) {
        target = null;
      } else {
        target = stops.reduce((best, stop) => (Math.abs(stop - visible) < Math.abs(best - visible) ? stop : best));
      }
      if (target === null) {
        onDismissRef.current();
        return;
      }
      if (detentRef.current) commit(target === floor ? 'half' : 'full');
      paint(target, floor, true);
    };

    // The keyboard and rotation change what half and full mean.
    const handleResize = () => {
      if (detentRef.current && !g) paint(detentHeight(sheet, detentRef.current), detentHeight(sheet, 'half'), false);
    };

    sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    sheet.addEventListener('touchend', handleTouchEnd);
    sheet.addEventListener('touchcancel', handleTouchEnd);
    window.addEventListener('resize', handleResize);
    return () => {
      thaw();
      sheet.removeEventListener('touchstart', handleTouchStart);
      sheet.removeEventListener('touchmove', handleTouchMove);
      sheet.removeEventListener('touchend', handleTouchEnd);
      sheet.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('resize', handleResize);
    };
  }, [open, sheetRef, edge, dir, paint, commit]);

  React.useEffect(() => {
    if (!open) commit(null);
  }, [open, commit]);

  return React.useMemo(() => ({ setDetent, toggleDetent, detent }), [setDetent, toggleDetent, detent]);
}
