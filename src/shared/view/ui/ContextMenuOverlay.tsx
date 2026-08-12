import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/utils';

const VIEWPORT_PADDING = 10;
const ANCHOR_GAP = 8;
// A tap leaves a click behind a few ms after touchend; swallow it so it cannot
// land on the row the menu covered. Short enough that a fresh tap keeps its own
// click.
const CLICK_SWALLOW_MS = 150;
// Insurance only: a gesture always ends with touchend/touchcancel/mouseup, but
// a shield that somehow outlived its gesture would freeze the whole app.
const SHIELD_MAX_MS = 2000;

/**
 * Where the menu should hang from: the pressed row's box on touch, or a
 * zero-height box at the cursor on right-click.
 */
export type ContextMenuAnchor = { top: number; bottom: number; left: number };

/**
 * Anchor a menu to the long-pressed row rather than the finger, so it is obvious
 * which row it belongs to. Falls back to the touch point if the row cannot be
 * measured.
 */
export function anchorFromElement(
  element: Element | null | undefined,
  fallback: { x: number; y: number },
): ContextMenuAnchor {
  const rect = element?.getBoundingClientRect();

  return rect && rect.height > 0
    ? { top: rect.top, bottom: rect.bottom, left: rect.left }
    : { top: fallback.y, bottom: fallback.y, left: fallback.x };
}

function calculateAnchoredPosition(
  anchor: ContextMenuAnchor,
  menuWidth: number,
  menuHeight: number,
  placement: 'auto' | 'above',
) {
  // Prefer just below the row; flip above when a downward menu would run off the
  // bottom. Either way it touches the row it belongs to.
  const spaceBelow = window.innerHeight - VIEWPORT_PADDING - (anchor.bottom + ANCHOR_GAP);
  const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_PADDING;

  const top =
    placement !== 'above' && (menuHeight <= spaceBelow || spaceBelow >= spaceAbove)
      ? Math.min(anchor.bottom + ANCHOR_GAP, window.innerHeight - menuHeight - VIEWPORT_PADDING)
      : anchor.top - ANCHOR_GAP - menuHeight;

  const maxLeft = window.innerWidth - menuWidth - VIEWPORT_PADDING;

  return {
    x: Math.max(VIEWPORT_PADDING, Math.min(anchor.left, maxLeft)),
    y: Math.max(VIEWPORT_PADDING, top),
  };
}

let releaseActiveTapShield: (() => void) | null = null;

/**
 * Keep the rest of the gesture that dismissed a menu inert: it must not scroll
 * the list or land on whatever the menu covered.
 *
 * A plain DOM element rather than React state — the menu's owner usually
 * unmounts the overlay the instant it is dismissed, and the shield must outlive
 * that. Released as the finger lifts: holding it longer ate the start of the
 * *next* swipe, because the browser fixes an element's `touch-action` when a
 * gesture begins on it and never revisits that mid-gesture.
 */
export function armTapShield() {
  releaseActiveTapShield?.();

  const shield = document.createElement('div');
  shield.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;touch-action:none;';
  document.body.appendChild(shield);

  // The finger still down already owns a scrolling gesture on the list;
  // `touch-action` cannot retract that, so block the moves outright.
  const blockScroll = (event: TouchEvent) => event.preventDefault();
  document.addEventListener('touchmove', blockScroll, { passive: false });

  const expiryTimer = window.setTimeout(() => release(), SHIELD_MAX_MS);

  function release() {
    document.removeEventListener('touchmove', blockScroll);
    document.removeEventListener('touchend', release);
    document.removeEventListener('touchcancel', release);
    document.removeEventListener('mouseup', release);
    window.clearTimeout(expiryTimer);
    shield.remove();
    releaseActiveTapShield = null;
    swallowNextClick();
  }

  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
  document.addEventListener('mouseup', release);
  releaseActiveTapShield = release;
}

function swallowNextClick() {
  let expiryTimer: number | null = null;

  const stopSwallowing = () => {
    document.removeEventListener('click', swallowClick, true);
    if (expiryTimer !== null) {
      window.clearTimeout(expiryTimer);
    }
  };

  function swallowClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    stopSwallowing();
  }

  document.addEventListener('click', swallowClick, true);
  expiryTimer = window.setTimeout(stopSwallowing, CLICK_SWALLOW_MS);
}

type ContextMenuOverlayProps = {
  anchor: ContextMenuAnchor;
  /**
   * Trigger element, re-measured whenever the viewport resizes. Supply it when
   * opening the menu can itself move the trigger — dismissing the mobile
   * keyboard grows the layout viewport, and the menu must follow the button
   * down instead of staying where it was measured.
   */
  anchorElement?: Element | null;
  /** Called on outside press, Escape, or a chosen action. */
  onDismiss: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** Classes for the menu box itself (the popover), not the overlay. */
  className?: string;
  /** Change this when the menu's contents change size, to force a re-measure. */
  measureKey?: string | number;
  /** Keep the menu on the row's upper side instead of choosing by available space. */
  placement?: 'auto' | 'above';
};

/**
 * Shared long-press / right-click menu surface: a portaled popover anchored to
 * its row, over a transparent catcher that freezes the list behind it. Used by
 * the file tree and the sidebar so both behave identically. No scrim or backdrop
 * blur (ADR 0001); the catcher is invisible.
 */
export default function ContextMenuOverlay({
  anchor,
  anchorElement,
  onDismiss,
  children,
  ariaLabel,
  className,
  measureKey,
  placement = 'auto',
}: ContextMenuOverlayProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [liveAnchor, setLiveAnchor] = useState(anchor);

  useLayoutEffect(() => {
    setLiveAnchor(anchor);
  }, [anchor]);

  useEffect(() => {
    if (!anchorElement) {
      return;
    }

    const remeasure = () => {
      const rect = anchorElement.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      setLiveAnchor((previous) =>
        previous.top === rect.top && previous.bottom === rect.bottom && previous.left === rect.left
          ? previous
          : { top: rect.top, bottom: rect.bottom, left: rect.left },
      );
    };

    const viewport = window.visualViewport;
    window.addEventListener('resize', remeasure);
    viewport?.addEventListener('resize', remeasure);

    return () => {
      window.removeEventListener('resize', remeasure);
      viewport?.removeEventListener('resize', remeasure);
    };
  }, [anchorElement]);

  // Position against the menu's real size (height varies with the action list),
  // before paint, so it never shows at the wrong spot first.
  useLayoutEffect(() => {
    const menuElement = menuRef.current;
    if (!menuElement) {
      return;
    }

    // offsetWidth/Height, not getBoundingClientRect: the `zoom-in-95` enter
    // animation has it scaled to 0.95 here, and a rect 5% short pushed the
    // flipped-above placement onto the row.
    setPosition(calculateAnchoredPosition(liveAnchor, menuElement.offsetWidth, menuElement.offsetHeight, placement));
  }, [liveAnchor, measureKey, placement]);

  // An outside press dismisses on touchstart/mousedown rather than click, so the
  // menu is gone the instant the screen is touched. The shield keeps the rest of
  // that gesture inert.
  const dismissOnOutsidePress = useCallback(() => {
    armTapShield();
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const handleEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    // The catcher's `touch-action: none` only governs gestures that *start*
    // after the menu opens; the finger that long-pressed already owns a
    // scrolling gesture on the row. Block that one too.
    const blockScrollWhileOpen = (event: TouchEvent) => {
      const menuElement = menuRef.current;
      if (menuElement && menuElement.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener('keydown', handleEscapeKeyDown);
    document.addEventListener('touchmove', blockScrollWhileOpen, { passive: false });

    return () => {
      document.removeEventListener('keydown', handleEscapeKeyDown);
      document.removeEventListener('touchmove', blockScrollWhileOpen);
    };
  }, [onDismiss]);

  useEffect(() => {
    // Arrow key support keeps the menu accessible without a mouse.
    const handleKeyboardMenuNavigation = (event: KeyboardEvent) => {
      const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (!menuItems || menuItems.length === 0) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = Array.from(menuItems).findIndex((menuItem) => menuItem === activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previousIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[previousIndex]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (activeElement?.hasAttribute('role')) {
          event.preventDefault();
          activeElement.click();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardMenuNavigation);

    return () => {
      document.removeEventListener('keydown', handleKeyboardMenuNavigation);
    };
  }, []);

  return createPortal(
    /*
      Inset is set inline, and the `inset-0` class deliberately avoided,
      because `body.pwa-mode .fixed.inset-0` (index.css) pushes fixed overlays
      below the header's safe-area padding. This overlay holds menu coordinates
      that are already viewport-relative, so that offset shifted the whole menu
      down — visible in the PWA only, as a fat gap below a row and none above one.
    */
    <div className="fixed z-[9999]" style={{ top: 0, right: 0, bottom: 0, left: 0, overscrollBehavior: 'contain' }}>
      {/*
        Transparent full-screen catcher (no scrim — matches the app-wide
        no-backdrop-filter preference). It dismisses on press rather than click,
        and its `touch-action: none` freezes the list underneath: scrolling the
        list while the menu floated in place made it impossible to tell which
        row the menu belonged to.
      */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onTouchStart={dismissOnOutsidePress}
        onMouseDown={dismissOnOutsidePress}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        style={{
          position: 'absolute',
          left: position?.x ?? 0,
          top: position?.y ?? 0,
          // A forced-above menu scrolls within the space above its row rather
          // than growing through it.
          maxHeight: placement === 'above'
            ? Math.max(0, liveAnchor.top - ANCHOR_GAP - VIEWPORT_PADDING)
            : undefined,
          // Hidden for the single layout pass that measures it.
          visibility: position ? 'visible' : 'hidden',
        }}
        className={cn(
          'select-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg',
          'animate-in fade-in-0 zoom-in-95',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
