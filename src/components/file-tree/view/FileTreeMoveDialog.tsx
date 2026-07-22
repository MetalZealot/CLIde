import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Folder, FolderInput, Loader2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { FileTreeNode } from '../types/types';

type DirectoryOption = {
  path: string;
  name: string;
  level: number;
  isDisabled: boolean;
  /** Has subdirectories, i.e. is expandable (always false for the root row — its children are always shown). */
  hasChildren: boolean;
};

type FileTreeMoveDialogProps = {
  item: FileTreeNode;
  files: FileTreeNode[];
  projectPath: string;
  operationLoading: boolean;
  onConfirm: (destinationPath: string) => void;
  onCancel: () => void;
};

export default function FileTreeMoveDialog({
  item,
  files,
  projectPath,
  operationLoading,
  onConfirm,
  onCancel,
}: FileTreeMoveDialogProps) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Collapsed by default: only the root's children are visible until expanded,
  // so a deep repo doesn't produce an endless list.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Node paths are absolute, so the item's current parent is its dirname.
  const currentParent = item.path.slice(0, item.path.lastIndexOf('/')) || projectPath;

  // Build the visible, indented list of candidate destinations from the
  // already-loaded tree, skipping the moved item itself and (for a directory)
  // its whole subtree — a folder can't be moved into itself.
  const directoryOptions = useMemo<DirectoryOption[]>(() => {
    const options: DirectoryOption[] = [
      {
        path: projectPath,
        name: t('fileTree.move.projectRoot', 'Project root'),
        level: 0,
        isDisabled: currentParent === projectPath,
        hasChildren: false,
      },
    ];

    const subdirectoriesOf = (nodes: FileTreeNode[]) =>
      nodes.filter((node) => node.type === 'directory' && node.path !== item.path);

    const walk = (nodes: FileTreeNode[], level: number) => {
      for (const node of subdirectoriesOf(nodes)) {
        options.push({
          path: node.path,
          name: node.name,
          level,
          isDisabled: node.path === currentParent,
          hasChildren: subdirectoriesOf(node.children ?? []).length > 0,
        });
        if (node.children && expandedPaths.has(node.path)) {
          walk(node.children, level + 1);
        }
      }
    };
    walk(files, 1);
    return options;
  }, [files, item.path, currentParent, projectPath, expandedPaths, t]);

  const toggleExpanded = (path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Tapping a row selects it and drills one level deeper (never collapses —
  // that would make "select an expanded folder" toggle it shut; the chevron
  // handles collapsing).
  const handleSelect = (option: DirectoryOption) => {
    setSelectedPath(option.path);
    if (option.hasChildren && !expandedPaths.has(option.path)) {
      toggleExpanded(option.path);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[70vh] w-full max-w-sm flex-col rounded-lg border border-border bg-background p-4 shadow-lg">
        <div className="mb-3 flex items-center gap-3">
          <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
            <FolderInput className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-foreground">
              {t('fileTree.move.title', 'Move to folder')}
            </h3>
            <p className="truncate text-sm text-muted-foreground">{item.name}</p>
          </div>
        </div>

        {/* Plain overflow div instead of ScrollArea: the shared component's inner
            h-full can't resolve inside a flex item sized by max-h, so it never
            scrolled. Making the flex item itself the scroller avoids the
            percentage-height chain entirely. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-border"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        >
          <div className="p-1">
            {directoryOptions.map((option) => {
              const isSelected = selectedPath === option.path;
              const isExpanded = expandedPaths.has(option.path);
              return (
                <div
                  key={option.path}
                  className="flex items-stretch"
                  style={{ paddingLeft: `${option.level * 12}px` }}
                >
                  {option.hasChildren ? (
                    // Kept enabled on disabled ("Current") rows: their
                    // subfolders are still legal destinations.
                    <button
                      type="button"
                      disabled={operationLoading}
                      onClick={() => toggleExpanded(option.path)}
                      aria-label={t(isExpanded ? 'fileTree.move.collapse' : 'fileTree.move.expand', isExpanded ? 'Collapse' : 'Expand')}
                      aria-expanded={isExpanded}
                      className="flex w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent/60"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-150',
                          isExpanded && 'rotate-90',
                        )}
                      />
                    </button>
                  ) : (
                    <span className="w-8 flex-shrink-0" />
                  )}
                  <button
                    disabled={option.isDisabled || operationLoading}
                    onClick={() => handleSelect(option)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-1 pr-2 text-left text-sm transition-colors',
                      option.isDisabled
                        ? 'opacity-50 cursor-not-allowed'
                        : isSelected
                        ? 'bg-accent'
                        : 'hover:bg-accent/60',
                    )}
                  >
                    <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {option.isDisabled && (
                      <span className="flex-shrink-0 text-xs text-muted-foreground">
                        {t('fileTree.move.currentLocation', 'Current')}
                      </span>
                    )}
                    {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={operationLoading}
            className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => selectedPath !== null && onConfirm(selectedPath)}
            disabled={selectedPath === null || operationLoading}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {operationLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('fileTree.move.confirm', 'Move')}
          </button>
        </div>
      </div>
    </div>
  );
}
