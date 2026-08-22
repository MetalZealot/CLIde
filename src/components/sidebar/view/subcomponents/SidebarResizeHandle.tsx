import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../../../../hooks/useSidebarWidth';

const KEYBOARD_STEP = 16;

type SidebarResizeHandleProps = {
  width: number;
  onWidthChange: (width: number) => void;
  onReset: () => void;
  t: TFunction;
};

/**
 * The sidebar's draggable right edge. Desktop only — the mobile drawer's width
 * is the viewport's.
 *
 * Sits in the sidebar's padding rather than taking layout width, so the row
 * beside it loses nothing to a control that is invisible at rest.
 */
export default function SidebarResizeHandle({
  width,
  onWidthChange,
  onReset,
  t,
}: SidebarResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  // Captured once per drag: the sidebar's left edge, so width is measured
  // rather than assumed to start at x=0.
  const originRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const parentRect = handleRef.current?.parentElement?.getBoundingClientRect();
    originRef.current = parentRect?.left ?? 0;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const dragTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }
    onWidthChange(event.clientX - originRef.current);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('tooltips.resizeSidebar', 'Resize sidebar')}
      title={t('tooltips.resizeSidebar', 'Resize sidebar')}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={dragTo}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onWidthChange(width - KEYBOARD_STEP);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onWidthChange(width + KEYBOARD_STEP);
        }
      }}
      className={cn(
        'absolute inset-y-0 right-0 z-20 hidden w-1.5 translate-x-1/2 cursor-col-resize md:block',
        // The line only appears under the pointer, so the edge reads as a
        // border until it is something you are about to move.
        'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-primary after:opacity-0 after:transition-opacity',
        'hover:after:opacity-60 focus-visible:outline-none focus-visible:after:opacity-100',
        isDragging && 'after:opacity-100',
      )}
    />
  );
}
