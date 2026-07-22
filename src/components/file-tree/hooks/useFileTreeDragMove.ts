import { useCallback, useRef, useState } from 'react';
import type { DragEvent, HTMLAttributes } from 'react';

import type { FileTreeNode } from '../types/types';

/**
 * Desktop drag-and-drop *move* for file-tree rows (distinct from
 * useFileTreeUpload, which handles OS-file drops). Internal drags are tagged
 * with a custom dataTransfer type so the two never collide: upload's root
 * handlers must ignore events carrying this type, and these handlers ignore
 * everything else (external drags fall through to the upload path).
 *
 * Enabled only for fine pointers — on touch devices, `draggable` rows would
 * collide with the long-press context menu (iOS Safari starts a native HTML5
 * drag on long-press), and the "Move to…" dialog covers that surface anyway.
 *
 * Drop semantics (standard file-explorer): directory rows accept drops,
 * file rows are dead zones (they swallow the event so a miss doesn't fall
 * through and become a move-to-root), tree background = project root
 * (`''` — the server resolves it to the root). Invalid targets (current
 * parent, the dragged folder's own subtree) never get preventDefault, so the
 * browser shows the not-allowed cursor.
 */

export const INTERNAL_DRAG_TYPE = 'application/x-cloudcli-file-tree-move';

export const isInternalDragEvent = (event: DragEvent) =>
  event.dataTransfer.types.includes(INTERNAL_DRAG_TYPE);

type DragMoveItemProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDragLeave' | 'onDrop'
>;

export type FileTreeDragMove = {
  enabled: boolean;
  draggedItem: FileTreeNode | null;
  /** Absolute path of the hovered drop directory; `''` = project root; null = none. */
  dropTargetPath: string | null;
  getItemDragProps: (item: FileTreeNode) => DragMoveItemProps;
  handleRootDragOver: (event: DragEvent) => void;
  handleRootDragLeave: (event: DragEvent) => void;
  handleRootDrop: (event: DragEvent) => void;
};

type UseFileTreeDragMoveOptions = {
  projectPath: string | null;
  onMoveToFolder: (item: FileTreeNode, destinationPath: string) => Promise<boolean>;
};

const parentDirOf = (absolutePath: string) => absolutePath.slice(0, absolutePath.lastIndexOf('/'));

export function useFileTreeDragMove({
  projectPath,
  onMoveToFolder,
}: UseFileTreeDragMoveOptions): FileTreeDragMove {
  // Fine-pointer check is a mount-time decision; a mid-session input swap
  // (tablet + mouse) just needs a reload.
  const [enabled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  );
  const [draggedItem, setDraggedItem] = useState<FileTreeNode | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  // Ref mirror: dragover can't read dataTransfer payloads (browser security),
  // so target validation reads the source from here instead.
  const draggedItemRef = useRef<FileTreeNode | null>(null);

  const clearDragState = useCallback(() => {
    draggedItemRef.current = null;
    setDraggedItem(null);
    setDropTargetPath(null);
  }, []);

  const isValidDropTarget = useCallback(
    (source: FileTreeNode, destinationPath: string) => {
      const sourceParent = parentDirOf(source.path);
      if (destinationPath === '') {
        // Root drop is a no-op for items already at the top level.
        return projectPath !== null && sourceParent !== projectPath;
      }
      if (destinationPath === sourceParent) return false;
      // A folder can't be moved into itself or its own subtree.
      if (source.type === 'directory' &&
          (destinationPath === source.path || destinationPath.startsWith(source.path + '/'))) {
        return false;
      }
      return true;
    },
    [projectPath],
  );

  const getItemDragProps = useCallback(
    (item: FileTreeNode): DragMoveItemProps => {
      if (!enabled) return {};

      const props: DragMoveItemProps = {
        draggable: true,
        onDragStart: (event) => {
          event.stopPropagation();
          event.dataTransfer.setData(INTERNAL_DRAG_TYPE, item.path);
          event.dataTransfer.effectAllowed = 'move';
          draggedItemRef.current = item;
          setDraggedItem(item);
        },
        onDragEnd: clearDragState,
      };

      if (item.type === 'directory') {
        props.onDragOver = (event) => {
          if (!isInternalDragEvent(event)) return; // external drag → upload path
          event.stopPropagation();
          const source = draggedItemRef.current;
          if (!source || !isValidDropTarget(source, item.path)) {
            setDropTargetPath((current) => (current === item.path ? null : current));
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetPath(item.path);
        };
        props.onDragLeave = (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTargetPath((current) => (current === item.path ? null : current));
          }
        };
        props.onDrop = (event) => {
          if (!isInternalDragEvent(event)) return;
          event.preventDefault();
          event.stopPropagation();
          const source = draggedItemRef.current;
          clearDragState();
          if (source && isValidDropTarget(source, item.path)) {
            void onMoveToFolder(source, item.path);
          }
        };
      } else {
        // Dead zone: swallow internal drags so they don't bubble to the root
        // handler and read as a move-to-root.
        props.onDragOver = (event) => {
          if (isInternalDragEvent(event)) {
            event.stopPropagation();
            setDropTargetPath((current) => (current === '' ? null : current));
          }
        };
        props.onDrop = (event) => {
          if (isInternalDragEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
      }

      return props;
    },
    [enabled, clearDragState, isValidDropTarget, onMoveToFolder],
  );

  // Root handlers go on the tree's scroll container: background = project root.
  const handleRootDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isInternalDragEvent(event)) return;
      const source = draggedItemRef.current;
      if (!source || !isValidDropTarget(source, '')) {
        setDropTargetPath((current) => (current === '' ? null : current));
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetPath('');
    },
    [enabled, isValidDropTarget],
  );

  const handleRootDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDropTargetPath((current) => (current === '' ? null : current));
    }
  }, []);

  const handleRootDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isInternalDragEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = draggedItemRef.current;
      clearDragState();
      if (source && isValidDropTarget(source, '')) {
        void onMoveToFolder(source, '');
      }
    },
    [enabled, clearDragState, isValidDropTarget, onMoveToFolder],
  );

  return {
    enabled,
    draggedItem,
    dropTargetPath,
    getItemDragProps,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
