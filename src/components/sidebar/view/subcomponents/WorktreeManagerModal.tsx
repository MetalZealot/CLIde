import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Archive, Check, GitBranch, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, RowActionsTrigger, type ContextMenuAnchor } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import type { CreateWorktreeOptions, CreateWorktreeOutcome, RepositoryEntry } from '../../types/types';
import { getCheckoutRefLabel, isDiscoveredCheckout, isMainCheckout } from '../../utils/utils';
import { compactHomePath, getBatchSelectableWorktrees, getWorktreeSessionCount } from '../../utils/worktreeManager';

import SidebarContextMenu, { type SidebarContextMenuItem } from './SidebarContextMenu';

type WorktreeManagerModalProps = {
  entry: RepositoryEntry;
  onClose: () => void;
  onRenameWorktree?: (projectId: string, displayName: string) => Promise<void> | void;
  onArchiveWorktrees?: (projects: Project[]) => void;
  onDeleteWorktrees?: (projects: Project[]) => void;
  onCreateWorktree: (options: CreateWorktreeOptions) => Promise<CreateWorktreeOutcome>;
  /** Gives a discovered checkout a project row; see `isDiscoveredCheckout`. */
  onAdoptCheckout?: (checkoutPath: string) => Promise<Project | null>;
  onOpenWorktree: (project: Project) => void;
  /**
   * Opens straight into the create form, set when the row's New Worktree button
   * was the way in — so that button lands on the thing it names.
   */
  startInCreate?: boolean;
  /** Reuses only the existing creation workflow from the New Session launcher. */
  creationOnly?: boolean;
  t: TFunction;
};

/** Sentinel for "wherever the repository's HEAD is", which sends no base ref. */
const CURRENT_HEAD = '';

/**
 * Worktree management for one repository row.
 *
 * A panel rather than a context-menu level: each worktree carries an action
 * menu plus a creation form, which is a list to work through, not a single tap.
 * Full-height on mobile (the PWA has no window to fall back on), a centred card
 * on desktop.
 *
 * Archive and Delete are CLIde-side only — they change what CLIde tracks and
 * never run `git worktree remove`, so the directory and its commits survive. The
 * copy says so, because "delete" would imply the tree.
 */
export default function WorktreeManagerModal({
  entry,
  onClose,
  onRenameWorktree,
  onArchiveWorktrees,
  onDeleteWorktrees,
  onCreateWorktree,
  onAdoptCheckout,
  onOpenWorktree,
  startInCreate = false,
  creationOnly = false,
  t,
}: WorktreeManagerModalProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isCreating, setIsCreating] = useState(startInCreate || creationOnly);
  const [newBranch, setNewBranch] = useState('');
  const [baseRef, setBaseRef] = useState<string>(CURRENT_HEAD);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [orphanWarning, setOrphanWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adoptingPath, setAdoptingPath] = useState<string | null>(null);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [actionMenu, setActionMenu] = useState<{ project: Project; anchor: ContextMenuAnchor } | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  const leadProjectId = entry.leadCheckout.projectId;
  const selectableWorktrees = getBatchSelectableWorktrees(entry.checkouts);
  const discoveredWorktrees = entry.checkouts.filter(isDiscoveredCheckout);
  const selectedWorktrees = selectableWorktrees.filter((project) => selectedProjectIds.has(project.projectId));
  const areAllSelected = selectableWorktrees.length > 0 && selectedWorktrees.length === selectableWorktrees.length;

  useEffect(() => {
    if (isCreating) {
      newBranchInputRef.current?.focus();
    }
  }, [isCreating]);

  /**
   * Branches load when the form opens rather than with the modal: most visits
   * are to rename or remove, and this spawns git on the server.
   */
  useEffect(() => {
    if (!isCreating) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await api.gitBranches(leadProjectId);
        const data = (await response.json()) as {
          localBranches?: string[];
          remoteBranches?: string[];
        };
        if (!cancelled) {
          setLocalBranches(data.localBranches ?? []);
          setRemoteBranches(data.remoteBranches ?? []);
        }
      } catch {
        // A base list that fails to load is not worth an error: the default
        // (current HEAD) still works, and git reports an unusable base itself.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isCreating, leadProjectId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const availableIds = new Set(
      getBatchSelectableWorktrees(entry.checkouts).map((project) => project.projectId),
    );
    setSelectedProjectIds((current) => {
      const next = new Set([...current].filter((projectId) => availableIds.has(projectId)));
      return next.size === current.size ? current : next;
    });
  }, [entry.checkouts]);

  const startRenaming = (project: Project) => {
    setEditingProjectId(project.projectId);
    setEditingName(project.displayName || project.projectId);
  };

  const toggleSelection = (projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const leaveSelectionMode = () => {
    setIsSelecting(false);
    setSelectedProjectIds(new Set());
  };

  const runBatchArchive = () => {
    if (selectedWorktrees.length === 0) {
      return;
    }
    onArchiveWorktrees?.(selectedWorktrees);
    leaveSelectionMode();
  };

  const runBatchDelete = () => {
    if (selectedWorktrees.length === 0) {
      return;
    }
    onDeleteWorktrees?.(selectedWorktrees);
    leaveSelectionMode();
  };

  const saveRename = async () => {
    if (!editingProjectId) {
      return;
    }

    const projectId = editingProjectId;
    setEditingProjectId(null);
    await onRenameWorktree?.(projectId, editingName);
  };

  const submitNewWorktree = async () => {
    const branch = newBranch.trim();
    if (!branch || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);
    setOrphanWarning(null);

    try {
      const outcome = await onCreateWorktree({
        projectId: leadProjectId,
        branch,
        baseRef: baseRef || null,
      });

      setNewBranch('');
      if (!creationOnly) {
        setIsCreating(false);
      }

      // The tree exists either way. When CLIde could not adopt it the modal stays
      // open holding the path — the only way back to a directory nothing else
      // names.
      if (!outcome.project) {
        setOrphanWarning(
          t('worktrees.createdButUnregistered', {
            path: outcome.worktreePath,
            reason: outcome.registrationError ?? '',
            defaultValue:
              'The worktree was created at {{path}}, but CLIde could not add it: {{reason}}',
          }),
        );
        return;
      }

      // Creating a worktree is only ever a prelude to working in it, so select
      // the new checkout and get out of the way.
      onOpenWorktree(outcome.project);
      onClose();
    } catch (error) {
      // git's refusal ("already checked out at ...", "path exists") is the only
      // useful thing to say, so it is shown verbatim.
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Gives a discovered checkout a project row. The refreshed list arrives through
   * `entry`, so the row becomes an ordinary one on its own.
   */
  const adoptCheckout = async (project: Project) => {
    if (!onAdoptCheckout) {
      return;
    }

    setAdoptingPath(project.fullPath);
    setAdoptError(null);

    try {
      await onAdoptCheckout(project.fullPath);
    } catch (error) {
      setAdoptError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdoptingPath(null);
    }
  };

  /**
   * A worktree git knows about that CLIde has no row for — created from a
   * terminal, script, or agent session. Listed so it can be reached at all, but
   * until adopted its id is synthetic, so rename, archive and remove have
   * nothing to address.
   */
  const renderDiscoveredWorktree = (project: Project) => {
    const refLabel = getCheckoutRefLabel(project);
    const isAdopting = adoptingPath === project.fullPath;

    return (
      <li key={project.projectId} className="border-b border-border/60 last:border-b-0">
        <div className="p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-muted-foreground">
                {project.displayName}
              </div>
              {refLabel && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3 flex-shrink-0 opacity-70" />
                  <span className="truncate">{refLabel}</span>
                </div>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-11 w-11 flex-shrink-0"
              disabled={isAdopting || !onAdoptCheckout}
              onClick={() => void adoptCheckout(project)}
              aria-label={t('worktrees.add', 'Add')}
              title={t('worktrees.add', 'Add')}
            >
              {isAdopting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <div className="mt-0.5 break-words text-xs leading-5 text-muted-foreground/70" title={project.fullPath}>
            {compactHomePath(project.fullPath)}
          </div>
        </div>
      </li>
    );
  };

  const renderWorktree = (project: Project) => {
    if (isDiscoveredCheckout(project)) {
      return renderDiscoveredWorktree(project);
    }

    const refLabel = getCheckoutRefLabel(project);
    const isEditing = editingProjectId === project.projectId;
    const isMain = isMainCheckout(project);
    const isSelected = selectedProjectIds.has(project.projectId);
    const sessionCount = getWorktreeSessionCount(project);

    return (
      <li key={project.projectId} className="border-b border-border/60 last:border-b-0">
        {isEditing ? (
          <div className="flex items-center gap-2 p-3">
            <input
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void saveRename();
                }
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setEditingProjectId(null);
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              // 16px keeps iOS Safari from zooming the viewport on focus.
              style={{ fontSize: '16px' }}
              autoFocus
              autoComplete="off"
            />
            <button
              type="button"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-green-500 text-white active:scale-90 dark:bg-green-600"
              onClick={() => void saveRename()}
              title={t('tooltips.save')}
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-500 text-white active:scale-90 dark:bg-gray-600"
              onClick={() => setEditingProjectId(null)}
              title={t('tooltips.cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="group p-3">
            <div className="flex items-start gap-2">
              {isSelecting && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelection(project.projectId)}
                  aria-label={t('worktrees.selectNamed', 'Select {{name}}', {
                    name: project.displayName || project.projectId,
                  })}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm text-foreground">
                    {project.displayName || project.projectId}
                  </span>
                  {isMain && (
                    <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('worktrees.main', 'main')}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span className="flex-shrink-0">
                    {t('worktrees.sessionCount', {
                      count: sessionCount,
                      defaultValue_one: '{{count}} session',
                      defaultValue: '{{count}} sessions',
                    })}
                  </span>
                  {refLabel && (
                    <>
                      <span aria-hidden className="opacity-40">·</span>
                      <GitBranch className="h-3 w-3 flex-shrink-0 opacity-70" />
                      <span className="truncate">{refLabel}</span>
                    </>
                  )}
                </div>
              </div>

              {!isSelecting && (
                <RowActionsTrigger
                  label={t('actions.rowActions', 'Actions for {{name}}', {
                    name: project.displayName || project.projectId,
                  })}
                  isOpen={actionMenu?.project.projectId === project.projectId}
                  onOpen={(anchor) => setActionMenu({ project, anchor })}
                  className="h-8 w-8"
                />
              )}
            </div>
            <div className="mt-0.5 break-words text-xs leading-5 text-muted-foreground/70" title={project.fullPath}>
              {compactHomePath(project.fullPath)}
            </div>
          </div>
        )}
      </li>
    );
  };

  const actionMenuItems: SidebarContextMenuItem[] = actionMenu
    ? [
        {
          key: 'rename',
          label: t('actions.rename'),
          icon: Pencil,
          onSelect: () => startRenaming(actionMenu.project),
        },
        {
          key: 'archive',
          label: t('actions.archive', 'Archive'),
          icon: Archive,
          showDividerBefore: true,
          onSelect: () => onArchiveWorktrees?.([actionMenu.project]),
        },
        {
          key: 'delete',
          label: t('actions.delete'),
          icon: Trash2,
          isDanger: true,
          onSelect: () => onDeleteWorktrees?.([actionMenu.project]),
        },
      ]
    : [];

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-full w-full flex-col overflow-hidden border-border bg-card shadow-2xl',
          'h-full rounded-none border-0 md:h-auto md:max-h-[80vh] md:max-w-lg md:rounded-xl md:border',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-border p-4"
          // The mobile sheet runs to the top of the viewport, so in the
          // standalone PWA the header clears the status bar itself.
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {creationOnly
                ? t('worktrees.create', 'Create worktree')
                : t('worktrees.title', 'Worktrees')}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{entry.displayName}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {!creationOnly && selectableWorktrees.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (isSelecting) {
                    leaveSelectionMode();
                    return;
                  }
                  setActionMenu(null);
                  setEditingProjectId(null);
                  setIsCreating(false);
                  setIsSelecting(true);
                }}
                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {isSelecting ? t('actions.cancel') : t('worktrees.select', 'Select')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('actions.cancel')}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!creationOnly && (
            <ul>
              {selectableWorktrees.length > 0 && (
                <li className="border-b border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('worktrees.inClide', 'In CLIde')}
                </li>
              )}
              {selectableWorktrees.map(renderWorktree)}
              {discoveredWorktrees.length > 0 && (
                <li className="border-b border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('worktrees.notAddedSection', 'Not added')}
                </li>
              )}
              {discoveredWorktrees.map(renderWorktree)}
            </ul>
          )}

          {adoptError && (
            <div className="flex items-start gap-2 border-b border-border/60 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{adoptError}</span>
            </div>
          )}

          {/*
            Not an error — the worktree was created. It is a loose end, and it
            stays on screen until dismissed because closing the modal is the
            last chance to read the path.
          */}
          {orphanWarning && (
            <div className="flex items-start gap-2 border-t border-border bg-orange-50 p-3 dark:bg-orange-900/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-orange-800 dark:text-orange-200">
                {orphanWarning}
              </p>
              <button
                type="button"
                onClick={() => setOrphanWarning(null)}
                aria-label={t('actions.cancel')}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {!isSelecting && (isCreating ? (
            <div className="space-y-2 border-t border-border bg-muted/20 p-3">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="new-worktree-branch">
                {t('worktrees.branchLabel', 'New branch')}
              </label>
              <input
                id="new-worktree-branch"
                ref={newBranchInputRef}
                type="text"
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void submitNewWorktree();
                  }
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    if (creationOnly) {
                      onClose();
                    } else {
                      setIsCreating(false);
                    }
                  }
                }}
                placeholder={t('worktrees.branchPlaceholder', 'feature/my-change')}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ fontSize: '16px' }}
                autoComplete="off"
                spellCheck={false}
              />
              <label className="block pt-1 text-xs font-medium text-muted-foreground" htmlFor="new-worktree-base">
                {t('worktrees.baseLabel', 'Start from')}
              </label>
              <select
                id="new-worktree-base"
                value={baseRef}
                onChange={(event) => setBaseRef(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ fontSize: '16px' }}
              >
                <option value={CURRENT_HEAD}>
                  {t('worktrees.baseCurrent', {
                    branch: getCheckoutRefLabel(entry.leadCheckout) || 'HEAD',
                    defaultValue: 'Current — {{branch}}',
                  })}
                </option>
                {localBranches.length > 0 && (
                  <optgroup label={t('worktrees.baseLocal', 'Local branches')}>
                    {localBranches.map((branch) => (
                      <option key={`local:${branch}`} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </optgroup>
                )}
                {remoteBranches.length > 0 && (
                  <optgroup label={t('worktrees.baseRemote', 'Remote-only branches')}>
                    {remoteBranches.map((branch) => (
                      <option key={`remote:${branch}`} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                {t(
                  'worktrees.createHint',
                  'Creates the branch and a worktree beside the repository, then adds it here.',
                )}
              </p>
              {createError && (
                <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{createError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!newBranch.trim() || isSubmitting}
                  onClick={() => void submitNewWorktree()}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-3.5 w-3.5" />
                  )}
                  {t('worktrees.create', 'Create worktree')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (creationOnly) {
                      onClose();
                    } else {
                      setIsCreating(false);
                      setCreateError(null);
                    }
                  }}
                >
                  {t('actions.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex w-full items-center gap-2 border-t border-border p-3 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{t('worktrees.new', 'New Worktree')}</span>
            </button>
          ))}
        </div>

        {/* The scope notice below owns the bottom inset; see `eb54fb7`. */}
        {!creationOnly && isSelecting && (
          <div className="border-t border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t('worktrees.selectedCount', {
                  count: selectedWorktrees.length,
                  defaultValue_one: '{{count}} selected',
                  defaultValue: '{{count}} selected',
                })}
              </span>
              <button
                type="button"
                onClick={() => setSelectedProjectIds(
                  areAllSelected
                    ? new Set()
                    : new Set(selectableWorktrees.map((project) => project.projectId)),
                )}
                className="text-xs font-medium text-primary hover:underline"
              >
                {areAllSelected
                  ? t('worktrees.clearAll', 'Clear all')
                  : t('worktrees.selectAll', 'Select all')}
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={selectedWorktrees.length === 0}
                onClick={runBatchArchive}
              >
                <Archive className="mr-2 h-3.5 w-3.5" />
                {t('actions.archive', 'Archive')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="flex-1 bg-red-600 text-white hover:bg-red-700"
                disabled={selectedWorktrees.length === 0}
                onClick={runBatchDelete}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t('actions.delete')}
              </Button>
            </div>
          </div>
        )}

        {!creationOnly && (
          <p className="border-t border-border bg-muted/30 p-3 pb-safe-area-inset-bottom text-xs text-muted-foreground">
            {t(
              'worktrees.scopeNotice',
              'Archive and Delete only change what CLIde tracks. The worktree stays on disk — use `git worktree remove` to delete it.',
            )}
          </p>
        )}
      </div>

      {actionMenu && (
        <SidebarContextMenu
          anchor={actionMenu.anchor}
          items={actionMenuItems}
          onClose={() => setActionMenu(null)}
          ariaLabel={t('actions.rowActions', 'Actions for {{name}}', {
            name: actionMenu.project.displayName || actionMenu.project.projectId,
          })}
        />
      )}
    </div>,
    document.body,
  );
}
