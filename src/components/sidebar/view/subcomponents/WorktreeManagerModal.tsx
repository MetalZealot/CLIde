import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Archive, Check, GitBranch, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import type { CreateWorktreeOptions, CreateWorktreeOutcome, RepositoryEntry } from '../../types/types';
import { getCheckoutRefLabel, isMainCheckout } from '../../utils/utils';

type WorktreeManagerModalProps = {
  entry: RepositoryEntry;
  onClose: () => void;
  onRenameWorktree?: (projectId: string, displayName: string) => Promise<void> | void;
  onArchiveWorktree?: (project: Project) => void;
  onRemoveWorktree?: (project: Project) => void;
  onCreateWorktree: (options: CreateWorktreeOptions) => Promise<CreateWorktreeOutcome>;
  onOpenWorktree: (project: Project) => void;
  /**
   * Opens straight into the create form. Set when the row's New Worktree
   * button was the way in, so that button lands on the thing it names rather
   * than on the list with the form still shut.
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
 * This is a panel rather than a context-menu level: each worktree carries three
 * actions of its own plus a creation form, which is a list to work through, not
 * a single tap. Full-height on mobile because the PWA has no window to fall
 * back on; a centred card on desktop.
 *
 * Archive and Remove are CLIde-side only — they change what CLIde tracks and
 * never run `git worktree remove`, so the directory and its commits survive
 * both. The copy says so, because "delete" would otherwise imply the tree.
 */
export default function WorktreeManagerModal({
  entry,
  onClose,
  onRenameWorktree,
  onArchiveWorktree,
  onRemoveWorktree,
  onCreateWorktree,
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
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  const leadProjectId = entry.leadCheckout.projectId;

  useEffect(() => {
    if (isCreating) {
      newBranchInputRef.current?.focus();
    }
  }, [isCreating]);

  /**
   * Branches are loaded when the form opens rather than with the modal: most
   * visits here are to rename or remove, and this spawns git on the server.
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

  const startRenaming = (project: Project) => {
    setEditingProjectId(project.projectId);
    setEditingName(project.displayName || project.projectId);
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

      // The tree exists either way. When CLIde could not adopt it the modal
      // stays open holding the path, because that path is the only way back to
      // a directory nothing else in the UI names.
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

      // Creating a worktree is only ever a prelude to working in it, so the new
      // checkout is selected and the manager gets out of the way.
      onOpenWorktree(outcome.project);
      onClose();
    } catch (error) {
      // git's refusal ("already checked out at ...", "path exists") is the only
      // useful thing to say here, so it is shown verbatim rather than replaced.
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderWorktree = (project: Project) => {
    const refLabel = getCheckoutRefLabel(project);
    const isEditing = editingProjectId === project.projectId;
    const isMain = isMainCheckout(project);

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
          <div className="flex items-center gap-2 p-3">
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
                {refLabel && (
                  <>
                    <GitBranch className="h-3 w-3 flex-shrink-0 opacity-70" />
                    <span className="truncate">{refLabel}</span>
                    <span aria-hidden className="opacity-40">·</span>
                  </>
                )}
                <span className="truncate opacity-70" title={project.fullPath}>
                  {project.fullPath}
                </span>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => startRenaming(project)}
                title={t('actions.rename')}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onArchiveWorktree?.(project)}
                title={t('actions.archive', 'Archive')}
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                onClick={() => onRemoveWorktree?.(project)}
                title={t('worktrees.remove', 'Remove from CLIde')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

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
          // standalone PWA the header has to clear the status bar itself.
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
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.cancel')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!creationOnly && <ul>{entry.checkouts.map(renderWorktree)}</ul>}

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

          {isCreating ? (
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
          )}
        </div>

        {!creationOnly && (
          <p className="border-t border-border bg-muted/30 p-3 pb-safe-area-inset-bottom text-xs text-muted-foreground">
            {t(
              'worktrees.scopeNotice',
              'Archive and Remove only change what CLIde tracks. The worktree stays on disk — use `git worktree remove` to delete it.',
            )}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
