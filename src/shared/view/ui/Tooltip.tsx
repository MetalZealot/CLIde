import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/utils';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
type TooltipAlign = 'start' | 'center' | 'end';

type TooltipProps = {
  children: ReactNode;
  content?: ReactNode;
  position?: TooltipPosition;
  align?: TooltipAlign;
  className?: string;
  delay?: number;
};

function getArrowClasses(position: TooltipPosition, align: TooltipAlign): string {
  const horizontalAlignment = align === 'start'
    ? 'left-4'
    : align === 'end'
      ? 'right-4'
      : 'left-1/2 -translate-x-1/2';
  const verticalAlignment = align === 'start'
    ? 'top-4'
    : align === 'end'
      ? 'bottom-4'
      : 'top-1/2 -translate-y-1/2';

  switch (position) {
    case 'top':
      return `top-full ${horizontalAlignment} border-t-gray-900 dark:border-t-gray-100`;
    case 'bottom':
      return `bottom-full ${horizontalAlignment} border-b-gray-900 dark:border-b-gray-100`;
    case 'left':
      return `left-full ${verticalAlignment} border-l-gray-900 dark:border-l-gray-100`;
    case 'right':
      return `right-full ${verticalAlignment} border-r-gray-900 dark:border-r-gray-100`;
    default:
      return `top-full ${horizontalAlignment} border-t-gray-900 dark:border-t-gray-100`;
  }
}

function Tooltip({
  children,
  content,
  position = 'top',
  align = 'center',
  className = '',
  delay = 350,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  // Store the timer id without forcing re-renders while hovering.
  const timeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const lastTouchAtRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);

  const updateTooltipPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const spacing = 8;
    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    };

    // Calculate tooltip position based on the specified position prop.
    switch (position) {
      case 'bottom':
        style.left = align === 'start'
          ? rect.left
          : align === 'end'
            ? rect.right
            : rect.left + rect.width / 2;
        style.top = rect.bottom + spacing;
        style.transform = align === 'start'
          ? undefined
          : align === 'end'
            ? 'translateX(-100%)'
            : 'translateX(-50%)';
        break;
      case 'left':
        style.left = rect.left - spacing;
        style.top = align === 'start'
          ? rect.top
          : align === 'end'
            ? rect.bottom
            : rect.top + rect.height / 2;
        style.transform = align === 'start'
          ? 'translateX(-100%)'
          : align === 'end'
            ? 'translate(-100%, -100%)'
            : 'translate(-100%, -50%)';
        break;
      case 'right':
        style.left = rect.right + spacing;
        style.top = align === 'start'
          ? rect.top
          : align === 'end'
            ? rect.bottom
            : rect.top + rect.height / 2;
        style.transform = align === 'start'
          ? undefined
          : align === 'end'
            ? 'translateY(-100%)'
            : 'translateY(-50%)';
        break;
      case 'top':
      default:
        style.left = align === 'start'
          ? rect.left
          : align === 'end'
            ? rect.right
            : rect.left + rect.width / 2;
        style.top = rect.top - spacing;
        style.transform = align === 'start'
          ? 'translateY(-100%)'
          : align === 'end'
            ? 'translate(-100%, -100%)'
            : 'translate(-50%, -100%)';
        break;
    }

    setTooltipStyle(style);
  }, [align, position]);

  const clearTooltipTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Hover show/hide is gated to real mouse pointers: after a tap, touch
  // browsers fire compatibility mouseenter with no mouseleave to follow, which
  // left the tooltip stuck open until the next touch. Compatibility mouse
  // events have no pointer-event counterparts, so pointerType is reliable
  // here; touch gets the long-press path below instead.
  const handlePointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    clearTooltipTimer();
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    clearTooltipTimer();
    setIsVisible(false);
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    clearTooltipTimer();
    setIsVisible(false);
    lastTouchAtRef.current = Date.now();
    longPressTriggeredRef.current = false;
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    timeoutRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsVisible(true);
    }, delay);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (
      !start
      || !touch
      || (Math.abs(touch.clientX - start.x) <= 10
        && Math.abs(touch.clientY - start.y) <= 10)
    ) {
      return;
    }

    clearTooltipTimer();
    touchStartRef.current = null;
    setIsVisible(false);
  };

  const handleTouchEnd = () => {
    clearTooltipTimer();
    touchStartRef.current = null;
    if (longPressTriggeredRef.current) {
      return;
    }
    setIsVisible(false);
  };

  // A long press is an informational gesture, not a click. Swallow the
  // compatibility click that touch browsers emit after the finger lifts so a
  // press on an actionable child (such as the composer mode picker) cannot
  // both show the tooltip and activate the child.
  const handleClickCapture = (event: React.MouseEvent) => {
    if (!longPressTriggeredRef.current) {
      return;
    }
    longPressTriggeredRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    // Android fires its native contextmenu at roughly the same time as our
    // long-press timer. Suppress it so the app tooltip is the only popup.
    if (Date.now() - lastTouchAtRef.current < 1000) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    // Avoid delayed updates after unmount.
    return () => {
      clearTooltipTimer();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setIsVisible(false);
      longPressTriggeredRef.current = false;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setTooltipStyle(null);
      return;
    }

    const rafId = window.requestAnimationFrame(updateTooltipPosition);
    const handleViewportChange = () => updateTooltipPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isVisible, updateTooltipPosition]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
    >
      {children}
      {isVisible && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          style={tooltipStyle || { position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0 }}
          className={cn(
            'px-2 py-1 text-xs font-medium text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 rounded shadow-lg whitespace-nowrap pointer-events-none',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            className
          )}
        >
          {content}
          {/* Arrow */}
          <div className={cn('absolute h-0 w-0 border-4 border-transparent', getArrowClasses(position, align))} />
        </div>,
        document.body
      )}
    </div>
  );
}

export default Tooltip;
