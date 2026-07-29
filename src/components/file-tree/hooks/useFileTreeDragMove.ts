import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, HTMLAttributes } from 'react';

import type { FileTreeNode } from '../types/types';

/**
 * Desktop drag-and-drop *move* for file-tree rows (distinct from
 * useFileTreeUpload, which handles OS-file drops). Internal drags are tagged
 * with a custom dataTransfer type so the two never collide: upload's root
 * handlers must ignore events carrying this type, and these handlers ignore
 * everything else (external drags fall through to the upload path).
 *
 * Drag moves the *set*: starting a drag on a selected row moves the whole
 * canonical selection, while starting on an unselected row replaces the
 * selection with that row and moves only it — the standard file-explorer rule.
 *
 * `draggable` rows are enabled only for mouse input: on touch they collide
 * with the long-press context menu (iOS Safari starts a native HTML5 drag on
 * long-press), and the "Move to…" dialog is the touch move surface anyway.
 *
 * Drop semantics (standard file-explorer): directory rows accept drops,
 * file rows are dead zones (they swallow the event so a miss doesn't fall
 * through and become a move-to-root), tree background = project root
 * (`''` — the server resolves it to the root). Invalid targets never get
 * preventDefault, so the browser shows the not-allowed cursor.
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
  /** Every source participating in the current drag; empty when none. */
  draggedPaths: Set<string>;
  /** Absolute path of the hovered drop directory; `''` = project root; null = none. */
  dropTargetPath: string | null;
  getItemDragProps: (item: FileTreeNode) => DragMoveItemProps;
  handleRootDragOver: (event: DragEvent) => void;
  handleRootDragLeave: (event: DragEvent) => void;
  handleRootDrop: (event: DragEvent) => void;
};

type UseFileTreeDragMoveOptions = {
  projectPath: string | null;
  /** Moves the canonical set; the caller issues one batch request for it. */
  onMoveToFolder: (sources: FileTreeNode[], destinationPath: string) => Promise<unknown>;
  /**
   * Resolves the sources a drag starting on `item` should move: the canonical
   * selection when `item` belongs to it, otherwise just `item` (having made it
   * the selection).
   */
  resolveDragSources: (item: FileTreeNode) => FileTreeNode[];
  /** Blocks new drags while a file operation is in flight. */
  isLocked?: boolean;
};

const parentDirOf = (absolutePath: string) => absolutePath.slice(0, absolutePath.lastIndexOf('/'));

/**
 * A small pill showing the count, used as the drag image for a multi-source
 * drag. Positioned off-screen because `setDragImage` needs a laid-out element.
 */
function createDragCountImage(count: number): HTMLElement {
  const badge = document.createElement('div');
  badge.textContent = String(count);
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText = [
    'position:fixed',
    'top:-1000px',
    'left:-1000px',
    'padding:4px 10px',
    'border-radius:9999px',
    'font:500 12px system-ui,sans-serif',
    'background:#2563eb',
    'color:#fff',
  ].join(';');
  document.body.appendChild(badge);
  return badge;
}

export function useFileTreeDragMove({
  projectPath,
  onMoveToFolder,
  resolveDragSources,
  isLocked = false,
}: UseFileTreeDragMoveOptions): FileTreeDragMove {
  // Seeded from the pointer media query so a desktop's very first gesture can
  // drag, then corrected by the actual input events — hybrid devices and
  // browsers that misreport pointer capabilities settle on whatever the user
  // is really using rather than on a mount-time guess.
  const [isFinePointer, setIsFinePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  );
  const [draggedPaths, setDraggedPaths] = useState<Set<string>>(() => new Set());
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  // Ref mirror: dragover can't read dataTransfer payloads (browser security),
  // so target validation reads the sources from here instead.
  const draggedSourcesRef = useRef<FileTreeNode[]>([]);
  const dragImageRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      setIsFinePointer((current) => {
        const isMouse = event.pointerType === 'mouse';
        return current === isMouse ? current : isMouse;
      });
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  const enabled = isFinePointer && !isLocked;

  const clearDragState = useCallback(() => {
    draggedSourcesRef.current = [];
    setDraggedPaths(new Set());
    setDropTargetPath(null);
    dragImageRef.current?.remove();
    dragImageRef.current = null;
  }, []);

  /**
   * A destination is valid when at least one source would actually move there.
   * Sources already sitting in the destination are legal no-ops (the server
   * skips them), but a destination where *every* source already lives has
   * nothing to do, so it shows not-allowed instead.
   */
  const isValidDropTarget = useCallback(
    (sources: FileTreeNode[], destinationPath: string) => {
      if (sources.length === 0) return false;

      const resolvedDestination = destinationPath === '' ? projectPath : destinationPath;
      if (resolvedDestination === null) return false;

      for (const source of sources) {
        // A folder can't be moved into itself or its own subtree.
        if (
          source.type === 'directory' &&
          (resolvedDestination === source.path ||
            resolvedDestination.startsWith(source.path + '/'))
        ) {
          return false;
        }
      }

      return sources.some((source) => parentDirOf(source.path) !== resolvedDestination);
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
          const sources = resolveDragSources(item);
          if (sources.length === 0) {
            event.preventDefault();
            return;
          }

          event.dataTransfer.setData(
            INTERNAL_DRAG_TYPE,
            sources.map((source) => source.path).join('\n'),
          );
          event.dataTransfer.effectAllowed = 'move';

          if (sources.length > 1) {
            const badge = createDragCountImage(sources.length);
            dragImageRef.current = badge;
            event.dataTransfer.setDragImage(badge, 12, 12);
          }

          draggedSourcesRef.current = sources;
          setDraggedPaths(new Set(sources.map((source) => source.path)));
        },
        onDragEnd: clearDragState,
      };

      if (item.type === 'directory') {
        props.onDragOver = (event) => {
          if (!isInternalDragEvent(event)) return; // external drag → upload path
          event.stopPropagation();
          if (!isValidDropTarget(draggedSourcesRef.current, item.path)) {
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
          const sources = draggedSourcesRef.current;
          const isValid = isValidDropTarget(sources, item.path);
          clearDragState();
          if (isValid) {
            void onMoveToFolder(sources, item.path);
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
    [enabled, clearDragState, isValidDropTarget, onMoveToFolder, resolveDragSources],
  );

  // Root handlers go on the tree's scroll container: background = project root.
  const handleRootDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isInternalDragEvent(event)) return;
      if (!isValidDropTarget(draggedSourcesRef.current, '')) {
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
      const sources = draggedSourcesRef.current;
      const isValid = isValidDropTarget(sources, '');
      clearDragState();
      if (isValid) {
        void onMoveToFolder(sources, '');
      }
    },
    [enabled, clearDragState, isValidDropTarget, onMoveToFolder],
  );

  return {
    enabled,
    draggedPaths,
    dropTargetPath,
    getItemDragProps,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
