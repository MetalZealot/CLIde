import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

/**
 * Touch-only long-press detection for mobile sidebar rows.
 *
 * Fires `onLongPress` with the touch coordinates after the finger is held
 * still for `delay` ms. The press is cancelled the moment the finger moves
 * beyond `moveThreshold` px on any axis, or on touchend/touchcancel/scroll —
 * so a scroll or the horizontal sidebar swipe can never also trigger a menu.
 *
 * The threshold deliberately matches useSidebarSwipe's CLAIM_THRESHOLD_PX (10):
 * that swipe only claims a gesture *after* 10 px of horizontal travel, so
 * cancelling our timer before 10 px cleanly cedes movement gestures to it.
 *
 * After a long-press fires, a suppress ref swallows the synthetic click that
 * follows the touch sequence so the row is not also selected (mirrors the
 * `longPressTriggeredRef` pattern in Tooltip.tsx). Spread `handlers` onto the
 * pressable element and drive the "recessed" press animation off `isPressing`.
 *
 * `isPressing` is set synchronously on touchstart and cleared on
 * touchend/cancel, a movement that cedes the gesture, or a scroll — so it stays
 * true for the whole hold. It exists because the CSS `:active` pseudo-class is
 * unreliable on touch: browsers apply it late (after they rule out a scroll) and
 * often drop it once our long-press timer fires, which made the recess flicker
 * for only a split second before the menu opened.
 */
export type LongPressCoords = { x: number; y: number };

type UseLongPressOptions = {
  delay?: number;
  moveThreshold?: number;
  disabled?: boolean;
};

export function useLongPress(
  onLongPress: (coords: LongPressCoords) => void,
  { delay = 500, moveThreshold = 10, disabled = false }: UseLongPressOptions = {},
) {
  const timerRef = useRef<number | null>(null);
  const startCoordsRef = useRef<LongPressCoords | null>(null);
  const triggeredRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // End the current press: drop the pending timer and release the recess.
  const cancelPress = useCallback(() => {
    clearTimer();
    setIsPressing(false);
  }, [clearTimer]);

  // Cancel a pending press if the list scrolls under the finger. `scroll`
  // doesn't bubble, so listen in the capture phase on the window.
  useEffect(() => {
    if (disabled) {
      return;
    }
    const handleScroll = () => cancelPress();
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      cancelPress();
    };
  }, [cancelPress, disabled]);

  const onTouchStart = useCallback(
    (event: ReactTouchEvent) => {
      if (disabled) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      triggeredRef.current = false;
      startCoordsRef.current = { x: touch.clientX, y: touch.clientY };
      clearTimer();
      // Recess immediately on touch-down for instant feedback, rather than
      // waiting for the browser to settle `:active`.
      setIsPressing(true);
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true;
        const coords = startCoordsRef.current;
        if (coords) {
          navigator.vibrate?.(10);
          onLongPress(coords);
        }
      }, delay);
    },
    [clearTimer, delay, disabled, onLongPress],
  );

  const onTouchMove = useCallback(
    (event: ReactTouchEvent) => {
      const start = startCoordsRef.current;
      const touch = event.touches[0];
      if (!start || !touch) {
        return;
      }
      const movedX = Math.abs(touch.clientX - start.x);
      const movedY = Math.abs(touch.clientY - start.y);
      if (movedX > moveThreshold || movedY > moveThreshold) {
        cancelPress();
      }
    },
    [cancelPress, moveThreshold],
  );

  const onTouchEnd = useCallback(() => {
    cancelPress();
  }, [cancelPress]);

  // Swallow the click that follows a fired long-press so the row isn't selected.
  const onClickCapture = useCallback((event: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (triggeredRef.current) {
      triggeredRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  // Long-press replaces the native context menu; suppress it on touch devices.
  const onContextMenu = useCallback(
    (event: { preventDefault: () => void }) => {
      if (!disabled) {
        event.preventDefault();
      }
    },
    [disabled],
  );

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
      onClickCapture,
      onContextMenu,
    },
    isPressing,
  };
}
