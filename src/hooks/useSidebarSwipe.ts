import { RefObject, useEffect, useRef } from 'react';

interface UseSidebarSwipeOptions {
  /** Only attach listeners when true (mobile overlay layout). */
  enabled: boolean;
  /** Current settled sidebar state. */
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The overlay wrapper (visibility/backdrop container). */
  containerRef: RefObject<HTMLElement | null>;
  /** The sliding panel that holds the sidebar. */
  panelRef: RefObject<HTMLElement | null>;
  /** The dimmed backdrop behind the panel. */
  backdropRef: RefObject<HTMLElement | null>;
}

/** A swipe to open may start anywhere in the left half — no fragile edge zone. */
const OPEN_BAND_RATIO = 0.5;
/** Horizontal travel before we decide this is a drag vs. a scroll/tap. */
const CLAIM_THRESHOLD_PX = 10;
/** Past this fraction of the panel width, release settles open. */
const COMMIT_RATIO = 0.4;
/** A flick faster than this (px/ms) settles in its direction regardless of distance. */
const COMMIT_VELOCITY = 0.4;
/** Fallback cleanup delay if transitionend doesn't fire (matches the CSS duration). */
const SNAP_MS = 260;

/**
 * True when some ancestor of `target` is a horizontal scroller that still has
 * room to move in the drag's direction — code blocks, tables, tab strips. That
 * scroll is the gesture's owner; the drawer must not take it.
 */
const scrollerOwnsDrag = (target: EventTarget | null, dx: number): boolean => {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node.scrollWidth - node.clientWidth > 1) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') {
        const remaining = dx > 0 ? node.scrollLeft : node.scrollWidth - node.clientWidth - node.scrollLeft;
        if (remaining > 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
};

/**
 * Drag-to-follow gesture for the mobile sidebar (ChatGPT/Discord style): the
 * panel tracks the finger in real time and snaps open/closed on release. The
 * open swipe may start anywhere in the left half of the screen, so it never
 * requires the extreme edge (which the OS reserves for its back gesture).
 *
 * The move is driven imperatively via refs for 60fps; React `isOpen` stays the
 * settled source of truth. Listeners are on `document` in the capture phase so
 * the panel's own `stopPropagation` handlers don't swallow them.
 */
export function useSidebarSwipe({
  enabled,
  isOpen,
  onOpen,
  onClose,
  containerRef,
  panelRef,
  backdropRef,
}: UseSidebarSwipeOptions) {
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!container || !panel || !backdrop) return;

    // The app shell div that hosts both the overlay and the main content.
    // Modals (Settings, wizards, confirm dialogs) portal to document.body,
    // *outside* this shell and layered above the sidebar — touches starting
    // in them must never drive the drawer.
    const appShell = container.parentElement;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let width = 0;
    let translate = 0;
    let target: EventTarget | null = null;
    let candidate = false; // touch could still become a drag
    let dragging = false; // horizontal drag claimed
    let snapToken = 0;

    const setTransition = (on: boolean) => {
      const value = on ? '' : 'none';
      panel.style.transition = value;
      backdrop.style.transition = value;
      container.style.transition = value;
    };

    // translate: -width (closed) .. 0 (open)
    const render = (next: number) => {
      translate = Math.max(-width, Math.min(0, next));
      const progress = width > 0 ? 1 + translate / width : 0;
      container.style.visibility = 'visible';
      container.style.opacity = '1';
      container.style.pointerEvents = progress > 0 ? 'auto' : 'none';
      panel.style.transform = `translateX(${translate}px)`;
      backdrop.style.opacity = String(progress);
    };

    const clearInline = () => {
      for (const el of [container, panel, backdrop]) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
        el.style.visibility = '';
        el.style.pointerEvents = '';
      }
    };

    const settle = (open: boolean) => {
      const token = ++snapToken;
      setTransition(true);
      container.style.visibility = 'visible';
      // Fade the whole overlay as one group on close so the scrim eases out
      // instead of snapping to hidden when the resting classes take over.
      container.style.opacity = open ? '1' : '0';
      container.style.pointerEvents = open ? 'auto' : 'none';
      panel.style.transform = `translateX(${open ? 0 : -width}px)`;
      backdrop.style.opacity = open ? '1' : '0';

      const wasOpen = isOpenRef.current;
      if (open && !wasOpen) onOpenRef.current();
      else if (!open && wasOpen) onCloseRef.current();

      const finish = () => {
        if (token !== snapToken) return; // a newer gesture took over
        panel.removeEventListener('transitionend', onEnd);
        // At this point the inline transform/opacity already match the resting
        // classes for `isOpen`, so clearing them causes no visible jump.
        clearInline();
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.propertyName === 'transform') finish();
      };
      panel.addEventListener('transitionend', onEnd);
      window.setTimeout(finish, SNAP_MS);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        candidate = false;
        return;
      }
      if (appShell && event.target instanceof Node && !appShell.contains(event.target)) {
        candidate = false; // touch began in a body-level portal (modal etc.)
        return;
      }
      const touch = event.touches[0];
      target = event.target;
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastT = event.timeStamp;
      velocity = 0;
      width = panel.getBoundingClientRect().width || Math.min(window.innerWidth * 0.85, 384);
      candidate = isOpenRef.current || startX <= window.innerWidth * OPEN_BAND_RATIO;
      dragging = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!candidate) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!dragging) {
        if (Math.abs(dx) < CLAIM_THRESHOLD_PX && Math.abs(dy) < CLAIM_THRESHOLD_PX) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          candidate = false; // vertical → leave it to the scroller
          return;
        }
        if (!isOpenRef.current && dx <= 0) {
          candidate = false; // opening only tracks a rightward pull
          return;
        }
        if (scrollerOwnsDrag(target, dx)) {
          candidate = false;
          return;
        }
        dragging = true;
        snapToken++; // cancel any in-flight snap cleanup
        setTransition(false);
      }

      event.preventDefault();
      render((isOpenRef.current ? 0 : -width) + dx);

      const dt = event.timeStamp - lastT;
      if (dt > 0) velocity = (touch.clientX - lastX) / dt;
      lastX = touch.clientX;
      lastT = event.timeStamp;
    };

    const onTouchEnd = () => {
      if (!dragging) {
        candidate = false;
        return;
      }
      dragging = false;
      candidate = false;
      const progress = width > 0 ? 1 + translate / width : 0;
      const open =
        Math.abs(velocity) > COMMIT_VELOCITY ? velocity > 0 : progress > COMMIT_RATIO;
      settle(open);
    };

    const opts = { capture: true } as const;
    document.addEventListener('touchstart', onTouchStart, { ...opts, passive: true });
    document.addEventListener('touchmove', onTouchMove, { ...opts, passive: false });
    document.addEventListener('touchend', onTouchEnd, { ...opts, passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { ...opts, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, opts);
      document.removeEventListener('touchmove', onTouchMove, opts);
      document.removeEventListener('touchend', onTouchEnd, opts);
      document.removeEventListener('touchcancel', onTouchEnd, opts);
      clearInline();
    };
  }, [enabled, containerRef, panelRef, backdropRef]);
}
