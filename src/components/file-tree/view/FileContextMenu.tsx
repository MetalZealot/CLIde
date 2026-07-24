import { Fragment, useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, FileText, FolderInput, FolderPlus, Pencil, RefreshCw, Trash2, type LucideIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useLongPress, type LongPressCoords } from '../../../hooks/useLongPress';
import { ContextMenuOverlay, anchorFromElement, type ContextMenuAnchor } from '../../../shared/view/ui';

type FileContextItem = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileContextItem[];
  [key: string]: unknown;
};

type ContextMenuAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  isDanger?: boolean;
  isDisabled?: boolean;
  shortcut?: string;
  showDividerBefore?: boolean;
};

// Android fires its own `contextmenu` at roughly the same moment our
// long-press timer does, so a single hold opened the menu twice — the native
// one anchored to the finger instead of the row, which read as the menu
// flashing at the press point before jumping to its anchored spot. Touch
// belongs to long-press; ignore a contextmenu this soon after a touch.
const TOUCH_CONTEXT_MENU_GUARD_MS = 1000;

export default function FileContextMenu({
  children,
  item,
  onRename,
  onMove,
  onDelete,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCopyPath,
  onDownload,
  isLoading = false,
  className = '',
}: {
  // A render function receives `isContextActive` so the row can stay
  // highlighted for as long as its menu is open.
  children: ReactNode | ((state: { isContextActive: boolean }) => ReactNode);
  item?: FileContextItem | null;
  onRename?: (item: FileContextItem) => void;
  onMove?: (item: FileContextItem) => void;
  onDelete?: (item: FileContextItem) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onRefresh?: () => void;
  onCopyPath?: (item: FileContextItem) => void;
  onDownload?: (item: FileContextItem) => void;
  isLoading?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<ContextMenuAnchor | null>(null);
  const rowWrapperRef = useRef<HTMLDivElement>(null);
  const lastTouchAtRef = useRef(0);

  const closeContextMenu = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const openContextMenuAtCursor = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (Date.now() - lastTouchAtRef.current < TOUCH_CONTEXT_MENU_GUARD_MS) {
      return;
    }

    setMenuAnchor({ top: event.clientY, bottom: event.clientY, left: event.clientX });
  }, []);

  // Touch access: long-press opens the same menu, anchored to the pressed row
  // (the wrapper is `display: contents`, so the row itself is its first child).
  const openContextMenuAtTouch = useCallback((coords: LongPressCoords) => {
    setMenuAnchor(anchorFromElement(rowWrapperRef.current?.firstElementChild, coords));
  }, []);

  const { handlers: longPressHandlers, isPressing } = useLongPress(openContextMenuAtTouch);

  // Rows nest (a directory's wrapper contains its children's wrappers), so a
  // child press must not also start the parent's long-press timer.
  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    lastTouchAtRef.current = Date.now();
    longPressHandlers.onTouchStart(event);
  }, [longPressHandlers]);

  const handleTouchEnd = useCallback(() => {
    lastTouchAtRef.current = Date.now();
    longPressHandlers.onTouchEnd();
  }, [longPressHandlers]);

  const runMenuActionAndClose = useCallback((action?: () => void) => {
    closeContextMenu();
    action?.();
  }, [closeContextMenu]);

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (item?.type === 'file') {
      return [
        {
          key: 'rename',
          icon: Pencil,
          label: t('fileTree.context.rename', 'Rename'),
          onSelect: () => onRename?.(item),
        },
        {
          key: 'moveTo',
          icon: FolderInput,
          label: t('fileTree.context.moveTo', 'Move to…'),
          onSelect: () => onMove?.(item),
        },
        {
          key: 'delete',
          icon: Trash2,
          label: t('fileTree.context.delete', 'Delete'),
          onSelect: () => onDelete?.(item),
          isDanger: true,
        },
        {
          key: 'copyPath',
          icon: Copy,
          label: t('fileTree.context.copyPath', 'Copy Path'),
          onSelect: () => onCopyPath?.(item),
          showDividerBefore: true,
        },
        {
          key: 'download',
          icon: Download,
          label: t('fileTree.context.download', 'Download'),
          onSelect: () => onDownload?.(item),
        },
      ];
    }

    if (item?.type === 'directory') {
      return [
        {
          key: 'newFile',
          icon: FileText,
          label: t('fileTree.context.newFile', 'New File'),
          onSelect: () => onNewFile?.(item.path),
        },
        {
          key: 'newFolder',
          icon: FolderPlus,
          label: t('fileTree.context.newFolder', 'New Folder'),
          onSelect: () => onNewFolder?.(item.path),
        },
        {
          key: 'rename',
          icon: Pencil,
          label: t('fileTree.context.rename', 'Rename'),
          onSelect: () => onRename?.(item),
          showDividerBefore: true,
        },
        {
          key: 'moveTo',
          icon: FolderInput,
          label: t('fileTree.context.moveTo', 'Move to…'),
          onSelect: () => onMove?.(item),
        },
        {
          key: 'delete',
          icon: Trash2,
          label: t('fileTree.context.delete', 'Delete'),
          onSelect: () => onDelete?.(item),
          isDanger: true,
        },
        {
          key: 'copyPath',
          icon: Copy,
          label: t('fileTree.context.copyPath', 'Copy Path'),
          onSelect: () => onCopyPath?.(item),
          showDividerBefore: true,
        },
        {
          key: 'download',
          icon: Download,
          label: t('fileTree.context.download', 'Download'),
          onSelect: () => onDownload?.(item),
        },
      ];
    }

    return [
      {
        key: 'newFile',
        icon: FileText,
        label: t('fileTree.context.newFile', 'New File'),
        onSelect: () => onNewFile?.(''),
      },
      {
        key: 'newFolder',
        icon: FolderPlus,
        label: t('fileTree.context.newFolder', 'New Folder'),
        onSelect: () => onNewFolder?.(''),
      },
      {
        key: 'refresh',
        icon: RefreshCw,
        label: t('fileTree.context.refresh', 'Refresh'),
        onSelect: onRefresh,
        showDividerBefore: true,
      },
    ];
  }, [item, onCopyPath, onDelete, onDownload, onMove, onNewFile, onNewFolder, onRefresh, onRename, t]);

  return (
    <>
      <div
        ref={rowWrapperRef}
        {...longPressHandlers}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onContextMenu={openContextMenuAtCursor}
        className={cn('contents', className)}
      >
        {typeof children === 'function'
          ? children({ isContextActive: isPressing || menuAnchor !== null })
          : children}
      </div>

      {menuAnchor && (
        <ContextMenuOverlay
          anchor={menuAnchor}
          onDismiss={closeContextMenu}
          ariaLabel={t('fileTree.context.menuLabel', 'File context menu')}
          className="min-w-[180px] px-1 py-1"
          measureKey={isLoading ? 'loading' : menuActions.length}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('fileTree.context.loading', 'Loading...')}</span>
            </div>
          ) : (
            menuActions.map((action) => (
              <Fragment key={action.key}>
                {action.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
                <button
                  role="menuitem"
                  tabIndex={action.isDisabled ? -1 : 0}
                  disabled={isLoading || action.isDisabled}
                  onClick={() => runMenuActionAndClose(action.onSelect)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-md transition-colors',
                    'focus:outline-none focus:bg-accent',
                    action.isDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : action.isDanger
                      ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                      : 'hover:bg-accent',
                    isLoading && 'pointer-events-none',
                  )}
                >
                  {action.icon && <action.icon className="h-4 w-4 flex-shrink-0" />}
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && <span className="font-mono text-xs text-muted-foreground">{action.shortcut}</span>}
                </button>
              </Fragment>
            ))
          )}
        </ContextMenuOverlay>
      )}
    </>
  );
}
