import { useCallback, useEffect, useMemo, useState } from 'react';

import type { FileTreeNode } from '../types/types';

/**
 * Multi-selection for the Files tab.
 *
 * Selection and activation are separate concepts: in normal mode a click still
 * opens a file or toggles a folder, and selection only takes over row clicks
 * once selection mode is on (entered explicitly, by a modifier-click, or from
 * the long-press menu). Selection is owned here, by `FileTree`, so the
 * recursive row component stays a dumb renderer that receives a boolean.
 *
 * Identity is the absolute path — the same key rows, operations, and the move
 * API already use. Node metadata is looked up on demand from the current tree.
 */

export type FileTreeSelectionMode = 'normal' | 'selection';

/** How a row click should be interpreted, derived from the original event. */
export type RowClickIntent = 'activate' | 'toggle' | 'range';

export type FileTreeSelection = {
  isSelectionMode: boolean;
  selectedPaths: Set<string>;
  selectedCount: number;
  /** Rows currently visible in the tree, in render order. */
  visiblePaths: string[];
  /** Selected nodes in stable visible order (selected-but-hidden rows come last). */
  selectedNodes: FileTreeNode[];
  /**
   * The set an operation should actually act on: duplicates removed and any
   * item already covered by a selected ancestor directory dropped.
   */
  canonicalSources: FileTreeNode[];
  isSelected: (path: string) => boolean;
  enterSelectionMode: (seedPath?: string) => void;
  exitSelectionMode: () => void;
  togglePath: (path: string) => void;
  selectRangeTo: (path: string) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  /** True when every visible row is selected (and there is at least one). */
  areAllVisibleSelected: boolean;
  nodeAtPath: (path: string) => FileTreeNode | undefined;
};

type UseFileTreeSelectionOptions = {
  /** The complete tree; the source of truth for whether a selected path still exists. */
  files: FileTreeNode[];
  /** The filtered tree actually being rendered. */
  filteredFiles: FileTreeNode[];
  expandedDirs: Set<string>;
  /** Clears selection whenever the project changes. */
  projectId: string | undefined;
};

/**
 * Walks the tree the way `FileTreeNode` renders it: filtered rows only, and a
 * directory's children only when it is expanded. This is the order Shift-range
 * and Select-all operate over — collapsed and filtered-out rows do not
 * participate.
 */
function flattenVisible(
  nodes: FileTreeNode[],
  expandedDirs: Set<string>,
  into: FileTreeNode[] = [],
): FileTreeNode[] {
  for (const node of nodes) {
    into.push(node);
    if (node.type === 'directory' && expandedDirs.has(node.path) && node.children?.length) {
      flattenVisible(node.children, expandedDirs, into);
    }
  }
  return into;
}

function indexTree(nodes: FileTreeNode[], into: Map<string, FileTreeNode>): Map<string, FileTreeNode> {
  for (const node of nodes) {
    into.set(node.path, node);
    if (node.children?.length) {
      indexTree(node.children, into);
    }
  }
  return into;
}

/**
 * Mirrors the server's canonicalization so the payload, the count shown in the
 * move dialog, and the drag validation all agree with what will happen. The
 * server repeats this — this copy is for a clear UI, not a trust boundary.
 */
export function canonicalizeSelection(nodes: FileTreeNode[]): FileTreeNode[] {
  const byPath = new Map<string, FileTreeNode>();
  for (const node of nodes) {
    if (!byPath.has(node.path)) {
      byPath.set(node.path, node);
    }
  }

  const ordered = [...byPath.values()].sort((a, b) => {
    const depthDelta = a.path.split('/').length - b.path.split('/').length;
    return depthDelta !== 0 ? depthDelta : a.path.localeCompare(b.path);
  });

  const kept: FileTreeNode[] = [];
  const keptDirectories: string[] = [];
  for (const node of ordered) {
    if (keptDirectories.some((dir) => node.path.startsWith(dir + '/'))) {
      continue;
    }
    kept.push(node);
    if (node.type === 'directory') {
      keptDirectories.push(node.path);
    }
  }

  return kept;
}

/** Ctrl on Windows/Linux, Cmd on macOS — one predicate for both conventions. */
export const isMultiSelectModifier = (event: { ctrlKey: boolean; metaKey: boolean }) =>
  event.ctrlKey || event.metaKey;

export function useFileTreeSelection({
  files,
  filteredFiles,
  expandedDirs,
  projectId,
}: UseFileTreeSelectionOptions): FileTreeSelection {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [rangeAnchorPath, setRangeAnchorPath] = useState<string | null>(null);

  const visibleNodes = useMemo(
    () => flattenVisible(filteredFiles, expandedDirs),
    [filteredFiles, expandedDirs],
  );
  const visiblePaths = useMemo(() => visibleNodes.map((node) => node.path), [visibleNodes]);

  // Indexed off the *unfiltered* tree: a row hidden by search is still selected
  // and still needs its metadata, so only genuine disappearance counts as gone.
  const pathIndex = useMemo(
    () => indexTree(files, new Map<string, FileTreeNode>()),
    [files],
  );

  // A watcher, terminal, or agent can delete a selected path out from under the
  // selection. When fresh tree data arrives, drop whatever no longer exists.
  useEffect(() => {
    setSelectedPaths((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const surviving = new Set([...previous].filter((path) => pathIndex.has(path)));
      return surviving.size === previous.size ? previous : surviving;
    });
    setRangeAnchorPath((previous) =>
      previous !== null && !pathIndex.has(previous) ? null : previous,
    );
  }, [pathIndex]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setRangeAnchorPath(null);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  // Switching projects always drops the selection; the paths belong to a
  // different filesystem now.
  useEffect(() => {
    setIsSelectionMode(false);
    setSelectedPaths(new Set());
    setRangeAnchorPath(null);
  }, [projectId]);

  const enterSelectionMode = useCallback((seedPath?: string) => {
    setIsSelectionMode(true);
    if (seedPath !== undefined) {
      setSelectedPaths((previous) => new Set(previous).add(seedPath));
      setRangeAnchorPath(seedPath);
    }
  }, []);

  const togglePath = useCallback((path: string) => {
    setIsSelectionMode(true);
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    // The most recent direct selection is always the range anchor, even when
    // the click deselected — that is where a following Shift-click extends from.
    setRangeAnchorPath(path);
  }, []);

  const selectRangeTo = useCallback(
    (path: string) => {
      setIsSelectionMode(true);

      const targetIndex = visiblePaths.indexOf(path);
      const anchorIndex = rangeAnchorPath === null ? -1 : visiblePaths.indexOf(rangeAnchorPath);

      // A stored anchor can stop being visible when search or a collapse
      // changes the rendered set; fall back to selecting just the clicked row
      // and making it the new anchor.
      if (targetIndex === -1 || anchorIndex === -1) {
        setSelectedPaths((previous) => new Set(previous).add(path));
        setRangeAnchorPath(path);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      setSelectedPaths((previous) => {
        // Add to the existing set rather than replacing it, so a range does not
        // silently discard Ctrl/Cmd picks made elsewhere.
        const next = new Set(previous);
        for (let index = start; index <= end; index += 1) {
          next.add(visiblePaths[index]);
        }
        return next;
      });
      // The anchor stays put so dragging the Shift-click further extends from
      // the same origin instead of walking.
    },
    [visiblePaths, rangeAnchorPath],
  );

  const selectAllVisible = useCallback(() => {
    setIsSelectionMode(true);
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      for (const path of visiblePaths) {
        next.add(path);
      }
      return next;
    });
  }, [visiblePaths]);

  const isSelected = useCallback((path: string) => selectedPaths.has(path), [selectedPaths]);

  const nodeAtPath = useCallback((path: string) => pathIndex.get(path), [pathIndex]);

  const selectedNodes = useMemo(() => {
    const ordered: FileTreeNode[] = [];
    const seen = new Set<string>();

    for (const node of visibleNodes) {
      if (selectedPaths.has(node.path)) {
        ordered.push(node);
        seen.add(node.path);
      }
    }
    // Selected rows hidden by search or a collapsed parent still belong to the
    // set; they are appended so operations act on the complete selection.
    for (const path of selectedPaths) {
      if (seen.has(path)) {
        continue;
      }
      const node = pathIndex.get(path);
      if (node) {
        ordered.push(node);
      }
    }

    return ordered;
  }, [visibleNodes, selectedPaths, pathIndex]);

  const canonicalSources = useMemo(() => canonicalizeSelection(selectedNodes), [selectedNodes]);

  const areAllVisibleSelected =
    visiblePaths.length > 0 && visiblePaths.every((path) => selectedPaths.has(path));

  return {
    isSelectionMode,
    selectedPaths,
    selectedCount: selectedPaths.size,
    visiblePaths,
    selectedNodes,
    canonicalSources,
    isSelected,
    enterSelectionMode,
    exitSelectionMode,
    togglePath,
    selectRangeTo,
    selectAllVisible,
    clearSelection,
    areAllVisibleSelected,
    nodeAtPath,
  };
}
