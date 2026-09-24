import { RefObject, useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  /** Only attach listeners when true (mobile layout). */
  enabled: boolean;
  /** The element that scrolls; a pull only starts while it sits at the top. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Moved imperatively, so a drag never re-renders the list. */
  indicatorRef: RefObject<HTMLElement | null>;
  onRefresh: () => Promise<unknown> | void;
}

/** Travel before the gesture is claimed as a pull rather than a tap or scroll. */
const CLAIM_THRESHOLD_PX = 10;
/** Finger travel is halved so the indicator lags the finger, as native pulls do. */
const RESISTANCE = 0.5;
const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;
const RESTING_PX = 48;
/** A local refresh finishes in a frame; the spinner stays long enough to be seen. */
const MIN_SPIN_MS = 500;
const INDICATOR_SIZE_PX = 36;

/**
 * Pull-down-to-refresh for a touch scroller. Horizontal drags are left alone so
 * the sidebar's own swipe-to-close keeps working.
 */
export function usePullToRefresh({ enabled, scrollRef, indicatorRef, onRefresh }: UsePullToRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) {
      return undefined;
    }

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let pulling = false;
    let distance = 0;

    const paint = (px: number, animate: boolean) => {
      const indicator = indicatorRef.current;
      if (!indicator) {
        return;
      }
      indicator.style.transition = animate ? 'transform 200ms ease, opacity 200ms ease' : 'none';
      indicator.style.transform = `translate(-50%, ${px - INDICATOR_SIZE_PX}px) rotate(${(px / TRIGGER_PX) * 270}deg)`;
      indicator.style.opacity = String(Math.min(1, px / TRIGGER_PX));
    };

    const onTouchStart = (event: TouchEvent) => {
      tracking = !refreshingRef.current && event.touches.length === 1 && scroller.scrollTop <= 0;
      pulling = false;
      distance = 0;
      if (tracking) {
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) {
        return;
      }
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!pulling) {
        if (Math.abs(dx) > CLAIM_THRESHOLD_PX && Math.abs(dx) >= Math.abs(dy)) {
          tracking = false;
          return;
        }
        if (dy < -CLAIM_THRESHOLD_PX || scroller.scrollTop > 0) {
          tracking = false;
          return;
        }
        if (dy <= CLAIM_THRESHOLD_PX) {
          return;
        }
        pulling = true;
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      distance = Math.min(MAX_PULL_PX, Math.max(0, (dy - CLAIM_THRESHOLD_PX) * RESISTANCE));
      paint(distance, false);
    };

    const onTouchEnd = () => {
      if (!pulling) {
        tracking = false;
        return;
      }
      tracking = false;
      pulling = false;

      if (distance < TRIGGER_PX) {
        paint(0, true);
        return;
      }

      refreshingRef.current = true;
      setIsRefreshing(true);
      paint(RESTING_PX, true);
      const minSpin = new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS));
      void Promise.all([Promise.resolve(onRefreshRef.current()).catch((error: unknown) => {
        console.error('Pull-to-refresh failed:', error);
      }), minSpin]).finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
        paint(0, true);
      });
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, indicatorRef, scrollRef]);

  return { isRefreshing };
}
