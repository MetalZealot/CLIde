import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import JSZip from 'jszip';
import { api } from '../../../utils/api';
import type { FileTreeNode } from '../types/types';
import type { FilePathChange, Project } from '../../../types/app';

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type ToastMessage = {
  message: string;
  type: 'success' | 'error';
};

export type DeleteConfirmation = {
  isOpen: boolean;
  item: FileTreeNode | null;
};

/** One `sourcePath` -> `targetPath` pair the server refused to overwrite. */
export type MoveConflict = {
  sourcePath: string;
  targetPath: string;
};

/**
 * A failed move, kept so the dialog can stay open and explain itself rather
 * than closing and dropping the user back to an unchanged tree.
 */
export type MoveFailure = {
  message: string;
  code?: string;
  conflicts?: MoveConflict[];
};

export type MoveOutcome = {
  moved: FilePathChange[];
  skippedCount: number;
};

export type UseFileTreeOperationsOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  /** Lets surfaces holding a path (the open editor, a preview) rebind after a move or rename. */
  onFilePathsChange?: (changes: FilePathChange[]) => void;
};

export type UseFileTreeOperationsResult = {
  // Rename operations
  renamingItem: FileTreeNode | null;
  renameValue: string;
  handleStartRename: (item: FileTreeNode) => void;
  handleCancelRename: () => void;
  handleConfirmRename: () => Promise<void>;
  setRenameValue: (value: string) => void;

  // Delete operations
  deleteConfirmation: DeleteConfirmation;
  handleStartDelete: (item: FileTreeNode) => void;
  handleCancelDelete: () => void;
  handleConfirmDelete: () => Promise<void>;

  // Move operations — every path takes a source set, single-item included
  movingItems: FileTreeNode[] | null;
  moveFailure: MoveFailure | null;
  handleStartMove: (items: FileTreeNode | FileTreeNode[]) => void;
  handleCancelMove: () => void;
  handleConfirmMove: (destinationPath: string) => Promise<boolean>;
  performMove: (sources: FileTreeNode[], destinationPath: string) => Promise<MoveOutcome | null>;

  // Create operations
  isCreating: boolean;
  newItemParent: string;
  newItemType: 'file' | 'directory';
  newItemName: string;
  handleStartCreate: (parentPath: string, type: 'file' | 'directory') => void;
  handleCancelCreate: () => void;
  handleConfirmCreate: () => Promise<void>;
  setNewItemName: (name: string) => void;

  // Other operations
  handleCopyPath: (item: FileTreeNode) => void;
  handleDownload: (item: FileTreeNode) => Promise<void>;

  // Loading state
  operationLoading: boolean;

  // Validation
  validateFilename: (name: string) => string | null;
};

export function useFileTreeOperations({
  selectedProject,
  onRefresh,
  showToast,
  onFilePathsChange,
}: UseFileTreeOperationsOptions): UseFileTreeOperationsResult {
  const { t } = useTranslation();

  // State
  const [renamingItem, setRenamingItem] = useState<FileTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    isOpen: false,
    item: null,
  });
  const [movingItems, setMovingItems] = useState<FileTreeNode[] | null>(null);
  const [moveFailure, setMoveFailure] = useState<MoveFailure | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);

  // Validation
  const validateFilename = useCallback((name: string): string | null => {
    if (!name || !name.trim()) {
      return t('fileTree.validation.emptyName', 'Filename cannot be empty');
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return t('fileTree.validation.invalidChars', 'Filename contains invalid characters');
    }
    if (RESERVED_NAMES.test(name)) {
      return t('fileTree.validation.reserved', 'Filename is a reserved name');
    }
    if (/^\.+$/.test(name)) {
      return t('fileTree.validation.dotsOnly', 'Filename cannot be only dots');
    }
    return null;
  }, [t]);

  // Rename operations
  const handleStartRename = useCallback((item: FileTreeNode) => {
    setRenamingItem(item);
    setRenameValue(item.name);
    setIsCreating(false);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingItem(null);
    setRenameValue('');
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingItem || !selectedProject) return;

    const error = validateFilename(renameValue);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (renameValue === renamingItem.name) {
      handleCancelRename();
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.renameFile(selectedProject.projectId, {
        oldPath: renamingItem.path,
        newName: renameValue,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename');
      }

      const data = await response.json();
      // A rename changes a path just as much as a move does; the open editor
      // has to follow it or its next save recreates the old name.
      if (data.oldPath && data.newPath) {
        onFilePathsChange?.([
          { oldPath: data.oldPath, newPath: data.newPath, type: renamingItem.type },
        ]);
      }

      showToast(t('fileTree.toast.renamed', 'Renamed successfully'), 'success');
      onRefresh();
      handleCancelRename();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [renamingItem, renameValue, selectedProject, validateFilename, showToast, t, onRefresh, handleCancelRename, onFilePathsChange]);

  // Delete operations
  const handleStartDelete = useCallback((item: FileTreeNode) => {
    setDeleteConfirmation({ isOpen: true, item });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmation({ isOpen: false, item: null });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { item } = deleteConfirmation;
    if (!item || !selectedProject) return;

    setOperationLoading(true);
    try {
      const response = await api.deleteFile(selectedProject.projectId, {
        path: item.path,
        type: item.type,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      showToast(
        item.type === 'directory'
          ? t('fileTree.toast.folderDeleted', 'Folder deleted')
          : t('fileTree.toast.fileDeleted', 'File deleted'),
        'success'
      );
      onRefresh();
      handleCancelDelete();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [deleteConfirmation, selectedProject, showToast, t, onRefresh, handleCancelDelete]);

  // Move operations
  const handleStartMove = useCallback((items: FileTreeNode | FileTreeNode[]) => {
    const sources = Array.isArray(items) ? items : [items];
    if (sources.length === 0) return;

    setMovingItems(sources);
    setMoveFailure(null);
    setRenamingItem(null);
    setIsCreating(false);
  }, []);

  const handleCancelMove = useCallback(() => {
    setMovingItems(null);
    setMoveFailure(null);
  }, []);

  /**
   * Shared by the "Move to…" dialog and desktop drag-and-drop. One request for
   * the whole set: the server preflights every source before renaming any of
   * them, so a conflict cannot leave the selection half-moved.
   *
   * Returns null on failure (and records `moveFailure`) so callers can keep the
   * selection and dialog open for a retry.
   */
  const performMove = useCallback(async (
    sources: FileTreeNode[],
    destinationPath: string,
  ): Promise<MoveOutcome | null> => {
    if (!selectedProject || sources.length === 0) return null;

    setOperationLoading(true);
    setMoveFailure(null);
    try {
      const response = await api.moveFiles(selectedProject.projectId, {
        sourcePaths: sources.map((source) => source.path),
        destinationPath,
      });

      const data = await response.json();

      if (!response.ok) {
        setMoveFailure({
          message: data.error || 'Failed to move',
          code: data.code,
          conflicts: data.conflicts,
        });
        showToast(data.error || t('fileTree.toast.moveFailed', 'Failed to move'), 'error');
        return null;
      }

      const moved: FilePathChange[] = Array.isArray(data.moved) ? data.moved : [];
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;

      // Rebind before refreshing so the editor never observes a tree that no
      // longer contains the path it is still holding.
      if (moved.length > 0) {
        onFilePathsChange?.(moved);
      }

      // `total`/`skipped` rather than i18next's `count`: that option triggers
      // plural-category lookup, which differs per locale (Russian needs four
      // forms). These strings only render for two or more items, so a single
      // form is correct everywhere.
      const movedMessage =
        moved.length === 1
          ? t('fileTree.toast.moved', 'Moved successfully')
          : t('fileTree.toast.movedCount', 'Moved {{total}} items', { total: moved.length });

      showToast(
        skippedCount === 0
          ? movedMessage
          // Sources that started in the destination did nothing; say so rather
          // than letting the count silently disagree with the selection.
          : t('fileTree.toast.movedSomeSkipped', '{{message}} ({{skipped}} already there)', {
              message: movedMessage,
              skipped: skippedCount,
            }),
        'success',
      );
      // One refresh for the whole batch, not one per item.
      onRefresh();
      return { moved, skippedCount };
    } catch (err) {
      const message = (err as Error).message;
      setMoveFailure({ message });
      showToast(message, 'error');
      return null;
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, showToast, t, onRefresh, onFilePathsChange]);

  const handleConfirmMove = useCallback(async (destinationPath: string): Promise<boolean> => {
    if (!movingItems) return false;

    const outcome = await performMove(movingItems, destinationPath);
    if (!outcome) {
      // Leave the dialog open on failure so the conflict stays readable and
      // another destination can be picked without rebuilding the selection.
      return false;
    }

    setMovingItems(null);
    setMoveFailure(null);
    return true;
  }, [movingItems, performMove]);

  // Create operations
  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'directory') => {
    setNewItemParent(parentPath || '');
    setNewItemType(type);
    setNewItemName(type === 'file' ? 'untitled.txt' : 'new-folder');
    setIsCreating(true);
    setRenamingItem(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewItemParent('');
    setNewItemName('');
  }, []);

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedProject) return;

    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.createFile(selectedProject.projectId, {
        path: newItemParent,
        type: newItemType,
        name: newItemName,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create');
      }

      showToast(
        newItemType === 'file'
          ? t('fileTree.toast.fileCreated', 'File created successfully')
          : t('fileTree.toast.folderCreated', 'Folder created successfully'),
        'success'
      );
      onRefresh();
      handleCancelCreate();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, newItemParent, newItemType, newItemName, validateFilename, showToast, t, onRefresh, handleCancelCreate]);

  // Copy path to clipboard
  const handleCopyPath = useCallback((item: FileTreeNode) => {
    navigator.clipboard.writeText(item.path).catch(() => {
      // Clipboard API may fail in some contexts (e.g., non-HTTPS)
      showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
      return;
    });
    showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
  }, [showToast, t]);

  const triggerBrowserDownload = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, []);

  // Download file or folder
  const handleDownload = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    setOperationLoading(true);
    try {
      if (item.type === 'directory') {
        // Download folder as ZIP
        await downloadFolderAsZip(item);
      } else {
        // Download single file
        await downloadSingleFile(item);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, showToast]);

  // Download a single file
  const downloadSingleFile = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    // Use the binary streaming endpoint so downloads preserve raw bytes.
    const response = await api.readFileBlob(selectedProject.projectId, item.path);

    if (!response.ok) {
      throw new Error('Failed to download file');
    }

    const blob = await response.blob();
    triggerBrowserDownload(blob, item.name);
  }, [selectedProject, triggerBrowserDownload]);

  // Download folder as ZIP
  const downloadFolderAsZip = useCallback(async (folder: FileTreeNode) => {
    if (!selectedProject) return;

    const zip = new JSZip();

    // Recursively get all files in the folder
    const collectFiles = async (node: FileTreeNode, currentPath: string) => {
      const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;

      if (node.type === 'file') {
        const response = await api.readFileBlob(selectedProject.projectId, node.path);
        if (!response.ok) {
          throw new Error(`Failed to download "${node.name}" for ZIP export`);
        }

        // Store raw bytes in the archive so binary files stay intact.
        const fileBytes = await response.arrayBuffer();
        zip.file(fullPath, fileBytes);
      } else if (node.type === 'directory' && node.children) {
        // Recursively process children
        for (const child of node.children) {
          await collectFiles(child, fullPath);
        }
      }
    };

    // If the folder has children, process them
    if (folder.children && folder.children.length > 0) {
      for (const child of folder.children) {
        await collectFiles(child, '');
      }
    }

    // Generate ZIP file
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerBrowserDownload(zipBlob, `${folder.name}.zip`);

    showToast(t('fileTree.toast.folderDownloaded', 'Folder downloaded as ZIP'), 'success');
  }, [selectedProject, showToast, t, triggerBrowserDownload]);

  return {
    // Rename operations
    renamingItem,
    renameValue,
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
    setRenameValue,

    // Delete operations
    deleteConfirmation,
    handleStartDelete,
    handleCancelDelete,
    handleConfirmDelete,

    // Move operations
    movingItems,
    moveFailure,
    handleStartMove,
    handleCancelMove,
    handleConfirmMove,
    performMove,

    // Create operations
    isCreating,
    newItemParent,
    newItemType,
    newItemName,
    handleStartCreate,
    handleCancelCreate,
    handleConfirmCreate,
    setNewItemName,

    // Other operations
    handleCopyPath,
    handleDownload,

    // Loading state
    operationLoading,

    // Validation
    validateFilename,
  };
}
