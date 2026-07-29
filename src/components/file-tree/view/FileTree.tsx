import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, X, Loader2, Folder, Upload } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { useExpandedDirectories } from '../hooks/useExpandedDirectories';
import { useFileTreeData } from '../hooks/useFileTreeData';
import { useFileTreeOperations } from '../hooks/useFileTreeOperations';
import { useFileTreeSearch } from '../hooks/useFileTreeSearch';
import { useFileTreeSelection, isMultiSelectModifier } from '../hooks/useFileTreeSelection';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import { useFileTreeUpload } from '../hooks/useFileTreeUpload';
import { useFileTreeDragMove, isInternalDragEvent } from '../hooks/useFileTreeDragMove';
import type { FileTreeImageSelection, FileTreeNode } from '../types/types';
import { formatFileSize, formatRelativeTime, isImageFile } from '../utils/fileTreeUtils';
import type { FilePathChange, Project } from '../../../types/app';
import { remapChangedPath } from '../../../utils/filePathChange';
import { ScrollArea, Input } from '../../../shared/view/ui';

import FileTreeBody from './FileTreeBody';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import FileTreeMoveDialog from './FileTreeMoveDialog';
import type { FileTreeSharedRowProps } from './FileTreeNode';
import FileTreeUploadProgress from './FileTreeUploadProgress';
import ImageViewer from './ImageViewer';


type FileTreeProps = {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
  /** Reports moves and renames so an open editor can rebind to the new path. */
  onFilePathsChange?: (changes: FilePathChange[]) => void;
};

const parentDirOf = (absolutePath: string) => absolutePath.slice(0, absolutePath.lastIndexOf('/'));

export default function FileTree({ selectedProject, onFileOpen, onFilePathsChange }: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // path -> row element, so keyboard navigation can move real DOM focus.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Show toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { files, loading, refreshFiles } = useFileTreeData(selectedProject);
  const { viewMode, changeViewMode } = useFileTreeViewMode();
  const { expandedDirs, toggleDirectory, expandDirectories, collapseAll } = useExpandedDirectories();
  const { searchQuery, setSearchQuery, filteredFiles } = useFileTreeSearch({
    files,
    expandDirectories,
  });

  const selection = useFileTreeSelection({
    files,
    filteredFiles,
    expandedDirs,
    projectId: selectedProject?.projectId,
  });

  // An open image preview points at a URL built from a path; a move would
  // leave it pointing at nothing, so it is remapped alongside the editor.
  const handleFilePathsChange = useCallback(
    (changes: FilePathChange[]) => {
      setSelectedImage((current) => {
        if (!current) return current;
        const newPath = remapChangedPath(current.path, changes);
        if (newPath === null) return current;
        return { ...current, path: newPath, name: newPath.slice(newPath.lastIndexOf('/') + 1) };
      });
      onFilePathsChange?.(changes);
    },
    [onFilePathsChange],
  );

  // File operations
  const operations = useFileTreeOperations({
    selectedProject,
    onRefresh: refreshFiles,
    showToast,
    onFilePathsChange: handleFilePathsChange,
  });

  // File upload (drag and drop)
  const upload = useFileTreeUpload({
    selectedProject,
    onRefresh: refreshFiles,
    showToast,
  });
  const operationLoading = operations.operationLoading || upload.operationLoading;

  /**
   * Dragging a selected row moves the whole canonical selection; dragging an
   * unselected row replaces the selection with that row and moves only it.
   */
  const resolveDragSources = useCallback(
    (item: FileTreeNode): FileTreeNode[] => {
      if (selection.selectedPaths.has(item.path)) {
        return selection.canonicalSources;
      }
      selection.clearSelection();
      return [item];
    },
    [selection],
  );

  const performBatchMove = useCallback(
    async (sources: FileTreeNode[], destinationPath: string) => {
      const outcome = await operations.performMove(sources, destinationPath);
      // Keep the selection on failure so another destination can be tried;
      // clear it only once the batch actually landed.
      if (outcome) {
        selection.exitSelectionMode();
      }
      return outcome;
    },
    [operations, selection],
  );

  // Desktop drag-to-move (internal drags; external OS drops stay on the upload path)
  const dragMove = useFileTreeDragMove({
    projectPath: selectedProject?.fullPath ?? null,
    onMoveToFolder: performBatchMove,
    resolveDragSources,
    isLocked: operationLoading,
  });
  const isRootDropTarget = dragMove.dropTargetPath === '' && dragMove.draggedPaths.size > 0;

  // Focus input when creating new item
  useEffect(() => {
    if (operations.isCreating && newItemInputRef.current) {
      newItemInputRef.current.focus();
      newItemInputRef.current.select();
    }
  }, [operations.isCreating]);

  // Focus input when renaming
  useEffect(() => {
    if (operations.renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [operations.renamingItem]);

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  // Centralized activation keeps file actions identical across all presentation modes.
  const activateItem = useCallback(
    (item: FileTreeNode) => {
      if (item.type === 'directory') {
        toggleDirectory(item.path);
        return;
      }

      if (isImageFile(item.name) && selectedProject) {
        setSelectedImage({
          name: item.name,
          path: item.path,
          projectPath: selectedProject.path,
          // Image URL uses the DB projectId so ImageViewer can hit the
          // /api/projects/:projectId/files/content endpoint directly.
          projectId: selectedProject.projectId,
        });
        return;
      }

      onFileOpen?.(item.path);
    },
    [onFileOpen, selectedProject, toggleDirectory],
  );

  /**
   * The one place modifier meaning is decided. Plain clicks keep opening files
   * in normal mode; a modifier-click enters selection mode without the user
   * having to find the Select control first.
   */
  const handleItemClick = useCallback(
    (item: FileTreeNode, event: ReactMouseEvent<HTMLElement>) => {
      if (event.shiftKey) {
        selection.selectRangeTo(item.path);
        return;
      }
      if (isMultiSelectModifier(event) || selection.isSelectionMode) {
        selection.togglePath(item.path);
        return;
      }
      activateItem(item);
    },
    [activateItem, selection],
  );

  const handleStartSelectionFromRow = useCallback(
    (item: FileTreeNode) => {
      selection.enterSelectionMode(item.path);
    },
    [selection],
  );

  const handleMoveSelection = useCallback(() => {
    if (selection.canonicalSources.length === 0) return;
    operations.handleStartMove(selection.canonicalSources);
  }, [operations, selection]);

  const focusRowAt = useCallback((path: string | undefined) => {
    if (!path) return;
    setFocusedPath(path);
    rowRefs.current.get(path)?.focus();
  }, []);

  /**
   * Tree keyboard contract (WAI-ARIA treeview): one tab stop, roving focus,
   * and selection kept independent of focus.
   */
  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const { visiblePaths } = selection;
      if (visiblePaths.length === 0) return;

      const currentIndex = focusedPath === null ? -1 : visiblePaths.indexOf(focusedPath);
      const currentPath = currentIndex === -1 ? undefined : visiblePaths[currentIndex];
      const currentNode = currentPath ? selection.nodeAtPath(currentPath) : undefined;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const nextPath = visiblePaths[Math.min(currentIndex + 1, visiblePaths.length - 1)];
          if (event.shiftKey && currentPath) {
            selection.selectRangeTo(nextPath);
          }
          focusRowAt(nextPath);
          return;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const nextPath = visiblePaths[Math.max(currentIndex - 1, 0)];
          if (event.shiftKey && currentPath) {
            selection.selectRangeTo(nextPath);
          }
          focusRowAt(nextPath);
          return;
        }
        case 'ArrowRight': {
          if (!currentNode) return;
          event.preventDefault();
          if (currentNode.type === 'directory' && !expandedDirs.has(currentNode.path)) {
            toggleDirectory(currentNode.path);
          } else if (currentNode.type === 'directory') {
            focusRowAt(visiblePaths[currentIndex + 1]);
          }
          return;
        }
        case 'ArrowLeft': {
          if (!currentNode) return;
          event.preventDefault();
          if (currentNode.type === 'directory' && expandedDirs.has(currentNode.path)) {
            toggleDirectory(currentNode.path);
          } else {
            const parentPath = parentDirOf(currentNode.path);
            if (visiblePaths.includes(parentPath)) {
              focusRowAt(parentPath);
            }
          }
          return;
        }
        case ' ': {
          if (!currentPath) return;
          // Space always selects and never opens — that separation is the
          // whole point of having both Space and Enter.
          event.preventDefault();
          if (event.shiftKey) {
            selection.selectRangeTo(currentPath);
          } else {
            selection.togglePath(currentPath);
          }
          return;
        }
        case 'Enter': {
          if (!currentNode) return;
          event.preventDefault();
          if (selection.isSelectionMode) {
            selection.togglePath(currentNode.path);
          } else {
            activateItem(currentNode);
          }
          return;
        }
        case 'Escape': {
          if (!selection.isSelectionMode) return;
          event.preventDefault();
          selection.exitSelectionMode();
          return;
        }
        case 'a':
        case 'A': {
          if (!isMultiSelectModifier(event)) return;
          // Visible rows only — never the whole unfiltered project.
          event.preventDefault();
          selection.selectAllVisible();
          return;
        }
        default:
      }
    },
    [selection, focusedPath, focusRowAt, expandedDirs, toggleDirectory, activateItem],
  );

  // Keep exactly one row tabbable: if focus was never set (or its row is gone),
  // the first visible row becomes the entry point.
  useEffect(() => {
    if (selection.visiblePaths.length === 0) {
      setFocusedPath((current) => (current === null ? current : null));
      return;
    }
    setFocusedPath((current) =>
      current !== null && selection.visiblePaths.includes(current)
        ? current
        : selection.visiblePaths[0],
    );
  }, [selection.visiblePaths]);

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  const rowSelection = useMemo(
    () => ({
      isSelectionMode: selection.isSelectionMode,
      selectedPaths: selection.selectedPaths,
      onToggleExpand: (item: FileTreeNode) => toggleDirectory(item.path),
    }),
    [selection.isSelectionMode, selection.selectedPaths, toggleDirectory],
  );

  const rowProps: FileTreeSharedRowProps = {
    viewMode,
    expandedDirs,
    onItemClick: handleItemClick,
    renderFileIcon,
    formatFileSize,
    formatRelativeTime: formatRelativeTimeLabel,
    onRename: operations.handleStartRename,
    onMove: (item) => operations.handleStartMove(item),
    onDelete: operations.handleStartDelete,
    onNewFile: (path) => operations.handleStartCreate(path, 'file'),
    onNewFolder: (path) => operations.handleStartCreate(path, 'directory'),
    onCopyPath: operations.handleCopyPath,
    onDownload: operations.handleDownload,
    onRefresh: refreshFiles,
    onSelectItem: handleStartSelectionFromRow,
    onMoveSelection: handleMoveSelection,
    dragMove,
    selection: rowSelection,
    focusedPath,
    onFocusRow: (item) => setFocusedPath(item.path),
    rowRefs,
    // Rename state and handlers for inline editing
    renamingItem: operations.renamingItem,
    renameValue: operations.renameValue,
    setRenameValue: operations.setRenameValue,
    handleConfirmRename: operations.handleConfirmRename,
    handleCancelRename: operations.handleCancelRename,
    renameInputRef,
    operationLoading,
  };

  if (loading) {
    return <FileTreeLoadingState />;
  }

  return (
    <div
      ref={upload.treeRef}
      className="relative flex h-full flex-col bg-background"
      // Internal row drags must not trigger the upload overlay/handlers; they
      // are handled by dragMove on the rows and the scroll container below.
      onDragEnter={(e) => { if (!isInternalDragEvent(e)) upload.handleDragEnter(e); }}
      onDragOver={(e) => { if (!isInternalDragEvent(e)) upload.handleDragOver(e); }}
      onDragLeave={(e) => { if (!isInternalDragEvent(e)) upload.handleDragLeave(e); }}
      onDrop={(e) => { if (!isInternalDragEvent(e)) void upload.handleDrop(e); }}
    >
      {/* Drag overlay */}
      {upload.isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10">
          <div className="flex items-center gap-3 rounded-lg bg-background/95 px-6 py-4 shadow-lg">
            <Upload className="h-6 w-6 text-blue-500" />
            <span className="text-sm font-medium">{t('fileTree.dropToUpload', 'Drop files to upload')}</span>
          </div>
        </div>
      )}

      <FileTreeHeader
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onUploadFiles={upload.handleFileSelect}
        onNewFile={() => operations.handleStartCreate('', 'file')}
        onNewFolder={() => operations.handleStartCreate('', 'directory')}
        onRefresh={refreshFiles}
        onCollapseAll={collapseAll}
        isSelectionMode={selection.isSelectionMode}
        selectedCount={selection.selectedCount}
        onStartSelection={() => selection.enterSelectionMode()}
        onExitSelection={selection.exitSelectionMode}
        onMoveSelection={handleMoveSelection}
        onSelectAllVisible={selection.selectAllVisible}
        areAllVisibleSelected={selection.areAllVisibleSelected}
        loading={loading}
        operationLoading={operationLoading}
        isUploading={upload.uploadProgress?.status === 'uploading'}
        uploadProgress={upload.uploadProgress?.progress ?? null}
      />

      <FileTreeUploadProgress upload={upload.uploadProgress} />

      {viewMode === 'detailed' && filteredFiles.length > 0 && <FileTreeDetailedColumns />}

      <ScrollArea
        className={cn(
          'flex-1 px-2 py-1',
          isRootDropTarget && 'bg-accent/30 ring-1 ring-inset ring-primary/50',
        )}
        // Tree background acts as a "move to project root" drop target.
        onDragOver={dragMove.handleRootDragOver}
        onDragLeave={dragMove.handleRootDragLeave}
        onDrop={dragMove.handleRootDrop}
      >
        {/* New item input */}
        {operations.isCreating && (
          <div
            className="mb-1 flex items-center gap-1.5 py-[3px] pr-2"
            style={{ paddingLeft: `${(operations.newItemParent.split('/').length - 1) * 16 + 4}px` }}
          >
            {operations.newItemType === 'directory' ? (
              <Folder className={cn(ICON_SIZE_CLASS, 'text-blue-500')} />
            ) : (
              <span className="ml-[18px]">{renderFileIcon(operations.newItemName)}</span>
            )}
            <Input
              ref={newItemInputRef}
              type="text"
              value={operations.newItemName}
              onChange={(e) => operations.setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') operations.handleConfirmCreate();
                if (e.key === 'Escape') operations.handleCancelCreate();
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (operations.isCreating) operations.handleConfirmCreate();
                }, 100);
              }}
              className="h-6 flex-1 text-sm"
              disabled={operationLoading}
            />
          </div>
        )}

        <FileTreeBody
          files={files}
          filteredFiles={filteredFiles}
          searchQuery={searchQuery}
          rowProps={rowProps}
          isMultiSelectable
          onKeyDown={handleTreeKeyDown}
        />
      </ScrollArea>

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Move to Folder Dialog */}
      {operations.movingItems && selectedProject && (
        <FileTreeMoveDialog
          sources={operations.movingItems}
          files={files}
          projectPath={selectedProject.fullPath}
          operationLoading={operationLoading}
          failure={operations.moveFailure}
          onConfirm={(destinationPath) => {
            void operations.handleConfirmMove(destinationPath).then((moved) => {
              if (moved) {
                selection.exitSelectionMode();
              }
            });
          }}
          onCancel={operations.handleCancelMove}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {operations.deleteConfirmation.isOpen && operations.deleteConfirmation.item && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">
                  {t('fileTree.delete.title', 'Delete {{type}}', {
                    type: operations.deleteConfirmation.item.type === 'directory' ? 'Folder' : 'File'
                  })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {operations.deleteConfirmation.item.name}
                </p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {operations.deleteConfirmation.item.type === 'directory'
                ? t('fileTree.delete.folderWarning', 'This folder and all its contents will be permanently deleted.')
                : t('fileTree.delete.fileWarning', 'This file will be permanently deleted.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={operations.handleCancelDelete}
                disabled={operationLoading}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={operations.handleConfirmDelete}
                disabled={operationLoading}
                className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {operationLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('fileTree.delete.confirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-[9999] px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2',
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          )}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
