import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type SidebarContextMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  isDanger?: boolean;
};

type SidebarContextMenuProps = {
  x: number;
  y: number;
  items: SidebarContextMenuItem[];
  onClose: () => void;
};

const VIEWPORT_PADDING = 8;

/**
 * Anchored popover for mobile long-press actions. Portaled to <body> so the
 * sidebar's transforms/overflow can't clip it, positioned at the touch point
 * and clamped to the viewport after measuring its real size. A transparent
 * full-screen catcher closes it on outside tap — no blur, no dark scrim
 * (matches the app-wide no-backdrop-filter preference).
 */
export default function SidebarContextMenu({ x, y, items, onClose }: SidebarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Clamp against the measured menu size so it never spills off-screen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_PADDING;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_PADDING;
    setPosition({
      left: Math.max(VIEWPORT_PADDING, Math.min(x, maxLeft)),
      top: Math.max(VIEWPORT_PADDING, Math.min(y, maxTop)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Transparent catcher: outside tap closes, no visual scrim. */}
      <div className="absolute inset-0" onClick={onClose} onContextMenu={(event) => event.preventDefault()} />
      <div
        ref={menuRef}
        role="menu"
        className="sidebar-context-menu absolute min-w-44 max-w-64 select-none overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg"
        style={{ left: position.left, top: position.top }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                item.isDanger
                  ? 'text-red-600 active:bg-red-50 dark:text-red-400 dark:active:bg-red-950'
                  : 'text-foreground active:bg-accent',
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
