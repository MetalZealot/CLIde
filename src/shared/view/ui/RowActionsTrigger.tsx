import { useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { MoreVertical } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { anchorFromElement, type ContextMenuAnchor } from './ContextMenuOverlay';

type RowActionsTriggerProps = {
  /** Accessible name and tooltip — include the row's title, e.g. "Actions for src/api". */
  label: string;
  /** True while this row's menu is open, so the trigger stays revealed under it. */
  isOpen: boolean;
  onOpen: (anchor: ContextMenuAnchor) => void;
  /**
   * Render as a `div[role="button"]` for the one case where the trigger sits
   * inside an existing `<button>` (the desktop repository row), because a
   * nested button is invalid markup. Keyboard activation is wired by hand there.
   */
  as?: 'button' | 'div';
  className?: string;
};

/**
 * The kebab that opens a dense row's action menu.
 *
 * Hidden until the row is hovered, so a long list stays scannable — a permanent
 * control on every row reads as texture rather than as an affordance. Two
 * escapes from that: `touch:opacity-100` (index.css) reveals it on devices that
 * report no hover, and `focus-visible` reveals it for keyboard users, so it is
 * never a focusable invisible control.
 *
 * It only produces an anchor; the caller owns the menu, so long-press,
 * right-click, and this trigger can all feed one menu definition.
 */
export default function RowActionsTrigger({
  label,
  isOpen,
  onOpen,
  as = 'button',
  className,
}: RowActionsTriggerProps) {
  const triggerRef = useRef<HTMLElement | null>(null);

  const openMenu = () => {
    const element = triggerRef.current;
    const rect = element?.getBoundingClientRect();
    onOpen(anchorFromElement(element, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }));
  };

  // The row underneath navigates (session) or expands (repository) on click, so
  // the kebab must not let its own click reach it.
  const handleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  };

  const triggerClassName = cn(
    'flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded',
    'text-muted-foreground transition-all duration-200',
    'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'touch:opacity-100 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
    // Stays put while its own menu is open, so the pointer can travel to the menu.
    isOpen && 'bg-accent text-foreground opacity-100',
    className,
  );

  if (as === 'div') {
    return (
      <div
        ref={(node) => {
          triggerRef.current = node;
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={label}
        title={label}
        onClick={handleClick}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          // Space would scroll, and either key would otherwise also activate the
          // enclosing row button.
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        className={triggerClassName}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </div>
    );
  }

  return (
    <button
      ref={(node) => {
        triggerRef.current = node;
      }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-label={label}
      title={label}
      onClick={handleClick}
      className={triggerClassName}
    >
      <MoreVertical className="h-3.5 w-3.5" />
    </button>
  );
}
