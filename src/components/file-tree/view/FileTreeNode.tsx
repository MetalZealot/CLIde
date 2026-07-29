import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { Check, ChevronRight, Folder, FolderOpen } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import type { FileTreeDragMove } from '../hooks/useFileTreeDragMove';
import { Input } from '../../../shared/view/ui';

import FileContextMenu from './FileContextMenu';

/**
 * What a row needs to know about selection. Deliberately just data and
 * callbacks: selection state lives in `FileTree`, so the recursive row
 * component stays a renderer and cannot drift between levels.
 */
export type FileTreeNodeSelection = {
  isSelectionMode: boolean;
  selectedPaths: Set<string>;
  /** Toggles expansion without touching selection (the chevron target). */
  onToggleExpand: (item: FileTreeNodeType) => void;
};

type FileTreeNodeProps = {
  item: FileTreeNodeType;
  level: number;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  /**
   * Receives the original event so `FileTree` can read Ctrl/Cmd and Shift.
   * Modifier meaning is decided in one place, never inferred per row.
   */
  onItemClick: (item: FileTreeNodeType, event: ReactMouseEvent<HTMLElement>) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onMove?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  onSelectItem?: (item: FileTreeNodeType) => void;
  onMoveSelection?: () => void;
  dragMove?: FileTreeDragMove;
  selection?: FileTreeNodeSelection;
  focusedPath?: string | null;
  onFocusRow?: (item: FileTreeNodeType) => void;
  rowRefs?: RefObject<Map<string, HTMLDivElement>>;
  // Rename state for inline editing
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
};

/**
 * Everything a row needs that is identical for every row in the tree. Bundled
 * so `FileTreeBody`/`FileTreeList` forward one object instead of re-listing
 * two dozen props at each level.
 */
export type FileTreeSharedRowProps = Omit<FileTreeNodeProps, 'item' | 'level'>;

type TreeItemIconProps = {
  item: FileTreeNodeType;
  isOpen: boolean;
  isSelectionMode: boolean;
  renderFileIcon: (filename: string) => ReactNode;
  onToggleExpand?: () => void;
};

function TreeItemIcon({
  item,
  isOpen,
  isSelectionMode,
  renderFileIcon,
  onToggleExpand,
}: TreeItemIconProps) {
  if (item.type === 'directory') {
    return (
      <span className="flex flex-shrink-0 items-center gap-0.5">
        {/* In selection mode the row itself toggles selection, so expansion
            needs its own target. `aria-hidden` because the treeitem's
            `aria-expanded` (with Left/Right arrows) already carries this for
            assistive tech — a nested button here would be invalid inside a
            treeitem. */}
        <span
          aria-hidden="true"
          onClick={
            isSelectionMode && onToggleExpand
              ? (event) => {
                  event.stopPropagation();
                  onToggleExpand();
                }
              : undefined
          }
          className={cn(
            'flex items-center justify-center',
            isSelectionMode && '-ml-0.5 w-5 rounded hover:bg-accent',
          )}
        >
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
              isOpen && 'rotate-90',
            )}
          />
        </span>
        {isOpen ? (
          <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-500" />
        ) : (
          <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </span>
    );
  }

  return <span className="ml-[18px] flex flex-shrink-0 items-center">{renderFileIcon(item.name)}</span>;
}

/** The check affordance shown on every row while selection mode is active. */
function SelectionIndicator({ isSelected }: { isSelected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
        isSelected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/40',
      )}
    >
      {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

export default function FileTreeNode({
  item,
  level,
  viewMode,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  onRename,
  onMove,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
  onRefresh,
  onSelectItem,
  onMoveSelection,
  dragMove,
  selection,
  focusedPath,
  onFocusRow,
  rowRefs,
  renamingItem,
  renameValue,
  setRenameValue,
  handleConfirmRename,
  handleCancelRename,
  renameInputRef,
  operationLoading,
}: FileTreeNodeProps) {
  const isDirectory = item.type === 'directory';
  const isOpen = isDirectory && expandedDirs.has(item.path);
  const hasChildren = Boolean(isDirectory && item.children && item.children.length > 0);
  const isRenaming = renamingItem?.path === item.path;
  const isDropTarget = dragMove?.dropTargetPath === item.path;
  const isBeingDragged = Boolean(dragMove?.draggedPaths.has(item.path));
  const isSelectionMode = Boolean(selection?.isSelectionMode);
  const isSelected = Boolean(selection?.selectedPaths.has(item.path));
  const isFocused = focusedPath === item.path;

  const nameClassName = cn(
    'text-[13px] leading-tight truncate',
    isDirectory ? 'font-medium text-foreground' : 'text-foreground/90',
  );

  // View mode only changes the row layout; selection, expansion, and recursion stay shared.
  const rowClassName = cn(
    viewMode === 'detailed'
      ? 'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100'
      : viewMode === 'compact'
      ? 'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100'
      : 'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm hover:bg-accent/60 transition-colors duration-100',
    isDirectory && isOpen && 'border-l-2 border-primary/30',
    (isDirectory && !isOpen) || !isDirectory ? 'border-l-2 border-transparent' : '',
    isDropTarget && 'bg-accent ring-1 ring-inset ring-primary/50',
    isBeingDragged && 'opacity-50',
    isSelected && 'bg-primary/15',
  );

  // Render rename input if this item is being renamed
  if (isRenaming && setRenameValue && handleConfirmRename && handleCancelRename) {
    return (
      <div
        className={cn(rowClassName, 'bg-accent/30')}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <TreeItemIcon
          item={item}
          isOpen={isOpen}
          isSelectionMode={false}
          renderFileIcon={renderFileIcon}
        />
        <Input
          ref={renameInputRef}
          type="text"
          value={renameValue || ''}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') handleConfirmRename();
            if (e.key === 'Escape') handleCancelRename();
          }}
          onBlur={() => {
            setTimeout(() => {
              handleConfirmRename();
            }, 100);
          }}
          className="h-6 flex-1 text-sm"
          disabled={operationLoading}
        />
      </div>
    );
  }

  const treeItemIcon = (
    <TreeItemIcon
      item={item}
      isOpen={isOpen}
      isSelectionMode={isSelectionMode}
      renderFileIcon={renderFileIcon}
      onToggleExpand={selection ? () => selection.onToggleExpand(item) : undefined}
    />
  );

  // `isContextActive` is true while the row is being long-pressed and for as
  // long as its context menu stays open, so it's clear which file the menu
  // belongs to.
  const renderRow = (isContextActive: boolean) => (
    <div
      className={cn(rowClassName, isContextActive && 'bg-accent ring-1 ring-inset ring-primary/50')}
      style={{ paddingLeft: `${level * 16 + 4}px` }}
      onClick={(event) => onItemClick(item, event)}
      {...(dragMove ? dragMove.getItemDragProps(item) : {})}
    >
      {viewMode === 'detailed' ? (
        <>
          <div className="col-span-5 flex min-w-0 items-center gap-1.5">
            {isSelectionMode && <SelectionIndicator isSelected={isSelected} />}
            {treeItemIcon}
            <span className={nameClassName}>{item.name}</span>
          </div>
          <div className="col-span-2 text-sm tabular-nums text-muted-foreground">
            {item.type === 'file' ? formatFileSize(item.size) : ''}
          </div>
          <div className="col-span-3 text-sm text-muted-foreground">{formatRelativeTime(item.modified)}</div>
          <div className="col-span-2 font-mono text-sm text-muted-foreground">{item.permissionsRwx || ''}</div>
        </>
      ) : viewMode === 'compact' ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            {isSelectionMode && <SelectionIndicator isSelected={isSelected} />}
            {treeItemIcon}
            <span className={nameClassName}>{item.name}</span>
          </div>
          <div className="ml-2 flex flex-shrink-0 items-center gap-3 text-sm text-muted-foreground">
            {item.type === 'file' && (
              <>
                <span className="tabular-nums">{formatFileSize(item.size)}</span>
                <span className="font-mono">{item.permissionsRwx}</span>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {isSelectionMode && <SelectionIndicator isSelected={isSelected} />}
          {treeItemIcon}
          <span className={nameClassName}>{item.name}</span>
        </>
      )}
    </div>
  );

  // Check if context menu callbacks are provided
  const hasContextMenu = onRename || onMove || onDelete || onNewFile || onNewFolder || onCopyPath || onDownload || onRefresh;

  return (
    <div
      // The treeitem owns its child group so `aria-expanded` describes the
      // right subtree; `aria-label` keeps the accessible name to this row's
      // own name rather than everything nested beneath it.
      role="treeitem"
      aria-label={item.name}
      aria-level={level + 1}
      aria-selected={isSelectionMode ? isSelected : undefined}
      aria-expanded={isDirectory && hasChildren ? isOpen : undefined}
      // Roving tabstop: exactly one row is tabbable at a time.
      tabIndex={isFocused ? 0 : -1}
      ref={(element) => {
        if (!rowRefs?.current) return;
        if (element) {
          rowRefs.current.set(item.path, element);
        } else {
          rowRefs.current.delete(item.path);
        }
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onFocusRow?.(item);
        }
      }}
      className={cn(
        'select-none outline-none',
        // A focus ring distinct from the selected fill, so "where am I" and
        // "what is chosen" never read as the same thing.
        isFocused && 'rounded-sm ring-1 ring-primary/70',
      )}
    >
      {hasContextMenu ? (
        <FileContextMenu
          item={item}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onDownload={onDownload}
          onRefresh={onRefresh}
          onSelectItem={onSelectItem}
          onMoveSelection={onMoveSelection}
          isSelectionMode={isSelectionMode}
          isItemSelected={isSelected}
          selectedCount={selection?.selectedPaths.size ?? 0}
        >
          {({ isContextActive }) => renderRow(isContextActive)}
        </FileContextMenu>
      ) : (
        renderRow(false)
      )}

      {isDirectory && isOpen && hasChildren && (
        <div className="relative" role="group">
          <span
            className="absolute bottom-0 top-0 border-l border-border/40"
            style={{ left: `${level * 16 + 14}px` }}
            aria-hidden="true"
          />
          {item.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              level={level + 1}
              viewMode={viewMode}
              expandedDirs={expandedDirs}
              onItemClick={onItemClick}
              renderFileIcon={renderFileIcon}
              formatFileSize={formatFileSize}
              formatRelativeTime={formatRelativeTime}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onCopyPath={onCopyPath}
              onDownload={onDownload}
              onRefresh={onRefresh}
              onSelectItem={onSelectItem}
              onMoveSelection={onMoveSelection}
              dragMove={dragMove}
              selection={selection}
              focusedPath={focusedPath}
              onFocusRow={onFocusRow}
              rowRefs={rowRefs}
              renamingItem={renamingItem}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              handleConfirmRename={handleConfirmRename}
              handleCancelRename={handleCancelRename}
              renameInputRef={renameInputRef}
              operationLoading={operationLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
