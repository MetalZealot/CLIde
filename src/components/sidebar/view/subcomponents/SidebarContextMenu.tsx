import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';

type SidebarContextMenuItemBase = {
  key: string;
  label: string;
  icon: LucideIcon;
  isDanger?: boolean;
  /** Separates a group above from this item (same convention as ActionMenu). */
  showDividerBefore?: boolean;
};

export type SidebarContextMenuItem = SidebarContextMenuItemBase & ({
  onSelect: () => void;
  /**
   * Leaves the overlay up so `onSelect` can replace the menu's contents — used
   * to step from a repository's checkout list into one checkout's actions.
   */
  keepOpen?: boolean;
  href?: never;
} | {
  /** Internal app link opened in a separate browser tab. */
  href: string;
  onSelect?: never;
  keepOpen?: never;
});

type SidebarContextMenuProps = {
  anchor: ContextMenuAnchor;
  items: SidebarContextMenuItem[];
  onClose: () => void;
  /** Names the menu for screen readers — include the row it acts on. */
  ariaLabel?: string;
};

/**
 * Actions for a project or session row, opened by long-press, by the row's
 * kebab, or by right-click. All of the positioning and touch behaviour —
 * anchored to the row it belongs to, list frozen behind it, outside press
 * dismisses instantly — lives in ContextMenuOverlay, shared with the file
 * tree's menu.
 */
export default function SidebarContextMenu({ anchor, items, onClose, ariaLabel }: SidebarContextMenuProps) {
  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onClose}
      ariaLabel={ariaLabel}
      className="sidebar-context-menu min-w-44 max-w-64 overflow-hidden rounded-xl py-1"
      measureKey={items.length}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const itemClassName = cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
          'focus:outline-none',
          item.isDanger
            ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 active:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus-visible:bg-red-950 dark:active:bg-red-950'
            : 'text-foreground hover:bg-accent focus-visible:bg-accent active:bg-accent',
        );
        const content = (
          <>
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{item.label}</span>
          </>
        );

        return (
          <Fragment key={item.key}>
            {item.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
            {'href' in item ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={onClose}
                className={itemClassName}
              >
                {content}
              </a>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onSelect();
                  if (!item.keepOpen) {
                    onClose();
                  }
                }}
                className={itemClassName}
              >
                {content}
              </button>
            )}
          </Fragment>
        );
      })}
    </ContextMenuOverlay>
  );
}
