import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';

export type SidebarContextMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  isDanger?: boolean;
};

type SidebarContextMenuProps = {
  anchor: ContextMenuAnchor;
  items: SidebarContextMenuItem[];
  onClose: () => void;
};

/**
 * Mobile long-press actions for a project or session row. All of the
 * positioning and touch behaviour — anchored to the row it belongs to, list
 * frozen behind it, outside press dismisses instantly — lives in
 * ContextMenuOverlay, shared with the file tree's menu.
 */
export default function SidebarContextMenu({ anchor, items, onClose }: SidebarContextMenuProps) {
  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onClose}
      className="sidebar-context-menu min-w-44 max-w-64 overflow-hidden rounded-xl py-1"
      measureKey={items.length}
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
    </ContextMenuOverlay>
  );
}
