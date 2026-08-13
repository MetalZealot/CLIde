import { Archive, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';

type SidebarSelectionBarProps = {
  count: number;
  onArchive: () => void;
  onDelete: () => void;
  onCancel: () => void;
  t: TFunction;
};

/**
 * Batch mode's toolbar. It takes the footer's place rather than stacking above
 * it: while a selection is live nothing in the footer applies to it, and on a
 * phone two stacked bars cost a third of the list.
 *
 * Count and exit share the top line so the exit is never adjacent to Delete.
 */
export default function SidebarSelectionBar({
  count,
  onArchive,
  onDelete,
  onCancel,
  t,
}: SidebarSelectionBarProps) {
  const hasSelection = count > 0;

  return (
    <div
      className="flex-shrink-0 border-t border-border bg-background px-3 py-2"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tabular-nums text-foreground">
          {t('selection.count', {
            count,
            defaultValue_one: '{{count}} selected',
            defaultValue: '{{count}} selected',
          })}
        </span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          {t('actions.cancel')}
        </Button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 text-xs"
          onClick={onArchive}
          disabled={!hasSelection}
        >
          <Archive className="mr-1.5 h-3.5 w-3.5" />
          {t('actions.archive')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 border-red-600/30 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
          onClick={onDelete}
          disabled={!hasSelection}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('actions.delete')}
        </Button>
      </div>
    </div>
  );
}
