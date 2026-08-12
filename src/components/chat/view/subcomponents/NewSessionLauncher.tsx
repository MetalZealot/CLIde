import { useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, Check, ChevronDown, Folder, GitBranch, Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import type { CreateWorktreeOptions, CreateWorktreeOutcome, RepositoryEntry } from '../../../sidebar/types/types';
import { buildRepositoryEntries, isDiscoveredCheckout, repositoryEntryKey } from '../../../sidebar/utils/utils';
import {
  getLauncherCheckoutLabel,
  resolveLauncherCheckoutSelection,
  resolvePrimaryCheckout,
} from '../../utils/newSessionLauncher';
import ProjectCreationWizard from '../../../project-creation-wizard';
import NextTaskBanner from '../../../task-master/view/NextTaskBanner';
import WorktreeManagerModal from '../../../sidebar/view/subcomponents/WorktreeManagerModal';

type NewSessionLauncherProps = {
  projects: Project[];
  selectedProject: Project | null;
  onTargetSelect: (project: Project) => void;
  onProjectsRefresh: () => Promise<Project[]>;
  onCreateWorktree: (options: CreateWorktreeOptions) => Promise<CreateWorktreeOutcome>;
  onAdoptCheckout: (checkoutPath: string) => Promise<Project | null>;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
};

type OpenMenu = 'project' | 'worktree' | null;

const menuItemClassName =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent';

export default function NewSessionLauncher({
  projects,
  selectedProject,
  onTargetSelect,
  onProjectsRefresh,
  onCreateWorktree,
  onAdoptCheckout,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: NewSessionLauncherProps) {
  const { t } = useTranslation('chat');
  const { t: sidebarT } = useTranslation('sidebar');
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const worktreeButtonRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [worktreeEntry, setWorktreeEntry] = useState<RepositoryEntry | null>(null);
  const [adoptingCheckoutPath, setAdoptingCheckoutPath] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const launcherProjects = useMemo(() => {
    if (!selectedProject || projects.some((project) => project.projectId === selectedProject.projectId)) {
      return projects;
    }
    return [selectedProject, ...projects];
  }, [projects, selectedProject]);
  const entries = useMemo(() => buildRepositoryEntries(launcherProjects), [launcherProjects]);
  const selectedEntry = selectedProject
    ? (entries.find((entry) => entry.key === repositoryEntryKey(selectedProject)) ?? null)
    : null;

  const selectEntry = (entry: RepositoryEntry) => {
    onTargetSelect(resolvePrimaryCheckout(entry));
    setOpenMenu(null);
  };

  const selectCheckout = async (checkout: Project) => {
    if (adoptingCheckoutPath) {
      return;
    }

    setCheckoutError(null);
    if (isDiscoveredCheckout(checkout)) {
      setAdoptingCheckoutPath(checkout.fullPath);
    }

    try {
      const selectedCheckout = await resolveLauncherCheckoutSelection(checkout, onAdoptCheckout);
      if (!selectedCheckout) {
        throw new Error(t('launcher.addWorktreeFailed', { defaultValue: 'Failed to add worktree' }));
      }
      onTargetSelect(selectedCheckout);
      setOpenMenu(null);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdoptingCheckoutPath(null);
    }
  };

  const startNewProject = () => {
    setOpenMenu(null);
    setShowProjectWizard(true);
  };

  const startNewWorktree = () => {
    if (!selectedEntry) {
      return;
    }
    setOpenMenu(null);
    setWorktreeEntry(selectedEntry);
  };

  const handleProjectCreated = async (createdProject?: Project) => {
    const refreshedProjects = await onProjectsRefresh();
    if (!createdProject) {
      return;
    }
    const canonicalProject =
      refreshedProjects.find((project) => project.projectId === createdProject.projectId) ?? createdProject;
    const refreshedEntry = buildRepositoryEntries(
      refreshedProjects.some((project) => project.projectId === canonicalProject.projectId)
        ? refreshedProjects
        : [canonicalProject, ...refreshedProjects],
    ).find((entry) => entry.key === repositoryEntryKey(canonicalProject));
    onTargetSelect(refreshedEntry ? resolvePrimaryCheckout(refreshedEntry) : canonicalProject);
  };

  const nextTaskPrompt = t('tasks.nextTaskPrompt', {
    defaultValue: 'Start the next task',
  });
  const projectLabel = selectedEntry?.displayName ?? t('launcher.selectProject', { defaultValue: 'Project' });
  const worktreeLabel = selectedProject
    ? getLauncherCheckoutLabel(selectedProject)
    : t('launcher.worktreeBranch', { defaultValue: 'Worktree' });

  return (
    <>
      {selectedProject && tasksEnabled && isTaskMasterInstalled && (
        <div className="px-2 pb-2 sm:px-4">
          <div className="mx-auto max-w-[54.25rem]">
            <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
          </div>
        </div>
      )}

      <div className="px-2 pb-1 sm:px-4">
        {/* One centred group, not two half-width cells, so the pair reads as a
            single control. Triggers size to their labels and only truncate once
            the row actually overflows; the floors below decide who gives way. */}
        <div className="mx-auto flex w-full max-w-[34.25rem] items-center justify-center gap-1">
          <button
            ref={projectButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'project'}
            onClick={() => setOpenMenu((current) => (current === 'project' ? null : 'project'))}
            className={cn(
              // Higher floor than the worktree side: project names are short and
              // carry the identity, branch names are long and expected to clip.
              'flex min-h-10 min-w-[8rem] items-center justify-center gap-1.5 rounded-lg px-2 text-sm',
              'text-muted-foreground transition-colors hover:text-foreground',
              openMenu === 'project' && 'text-foreground',
            )}
            title={projectLabel}
          >
            <Folder className="h-4 w-4 flex-shrink-0" />
            <span className={cn('truncate', selectedEntry && 'font-medium text-foreground')}>{projectLabel}</span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 flex-shrink-0 transition-transform', openMenu === 'project' && 'rotate-180')}
            />
          </button>

          <button
            ref={worktreeButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'worktree'}
            disabled={!selectedEntry}
            onClick={() => setOpenMenu((current) => (current === 'worktree' ? null : 'worktree'))}
            className={cn(
              'flex min-h-10 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg px-2 text-sm',
              'text-muted-foreground transition-colors hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground',
              openMenu === 'worktree' && 'text-foreground',
            )}
            title={worktreeLabel}
          >
            <GitBranch className="h-4 w-4 flex-shrink-0" />
            <span className={cn('truncate', selectedProject && 'font-medium text-foreground')}>{worktreeLabel}</span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 flex-shrink-0 transition-transform', openMenu === 'worktree' && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      {openMenu === 'project' && projectButtonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(projectButtonRef.current, { x: 0, y: 0 })}
          anchorElement={projectButtonRef.current}
          onDismiss={() => setOpenMenu(null)}
          ariaLabel={t('launcher.chooseProject', {
            defaultValue: 'Choose a project',
          })}
          placement="above"
          className="sidebar-context-menu max-h-[min(65vh,24rem)] min-w-56 max-w-[calc(100vw-1.25rem)] overflow-y-auto rounded-xl py-1"
          measureKey={`${entries.length}:${selectedEntry?.key ?? 'none'}`}
        >
          {entries.map((entry) => {
            const isSelected = entry.key === selectedEntry?.key;
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => selectEntry(entry)}
                className={menuItemClassName}
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className={cn('truncate', isSelected && 'font-medium')}>{entry.displayName}</span>
              </button>
            );
          })}

          {entries.length > 0 && <div className="my-1 border-t border-border" />}

          <button type="button" role="menuitem" onClick={startNewProject} className={menuItemClassName}>
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" />
            <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>{t('launcher.newProject', { defaultValue: 'New Project…' })}</span>
          </button>
        </ContextMenuOverlay>
      )}

      {openMenu === 'worktree' && selectedEntry && worktreeButtonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(worktreeButtonRef.current, {
            x: 0,
            y: 0,
          })}
          anchorElement={worktreeButtonRef.current}
          onDismiss={() => setOpenMenu(null)}
            ariaLabel={t('launcher.chooseWorktree', {
              defaultValue: 'Choose a worktree or branch',
            })}
            placement="above"
          className="sidebar-context-menu max-h-[min(65vh,24rem)] min-w-56 max-w-[calc(100vw-1.25rem)] overflow-y-auto rounded-xl py-1"
          measureKey={`${selectedEntry.checkouts.length}:${selectedProject?.projectId ?? 'none'}:${checkoutError ?? ''}`}
        >
          {selectedEntry.checkouts.map((checkout) => {
            const isSelected = checkout.projectId === selectedProject?.projectId;
            const isDiscovered = isDiscoveredCheckout(checkout);
            const isAdopting = adoptingCheckoutPath === checkout.fullPath;
            return (
              <button
                key={checkout.projectId}
                type="button"
                role="menuitem"
                aria-current={isSelected ? 'true' : undefined}
                disabled={Boolean(adoptingCheckoutPath)}
                onClick={() => void selectCheckout(checkout)}
                className={cn(menuItemClassName, 'disabled:cursor-wait disabled:opacity-60')}
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isAdopting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    : isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <GitBranch className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}>
                  {getLauncherCheckoutLabel(checkout)}
                </span>
                {isDiscovered && (
                  <span
                    title={sidebarT('worktrees.discoveredHint', 'Found on disk, not added to CLIde yet.')}
                    className="ml-auto flex-shrink-0 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {sidebarT('worktrees.notAdded', 'not added')}
                  </span>
                )}
              </button>
            );
          })}

          {checkoutError && (
            <div className="flex items-start gap-2 border-t border-border bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{checkoutError}</span>
            </div>
          )}

          {selectedEntry.repositoryId && (
            <>
              <div className="my-1 border-t border-border" />
              <button type="button" role="menuitem" onClick={startNewWorktree} className={menuItemClassName}>
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" />
                <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span>
                  {t('launcher.newWorktree', {
                    defaultValue: 'New Worktree…',
                  })}
                </span>
              </button>
            </>
          )}
        </ContextMenuOverlay>
      )}

      {showProjectWizard && (
        <ProjectCreationWizard onClose={() => setShowProjectWizard(false)} onProjectCreated={handleProjectCreated} />
      )}

      {worktreeEntry && (
        <WorktreeManagerModal
          entry={worktreeEntry}
          onClose={() => setWorktreeEntry(null)}
          onCreateWorktree={onCreateWorktree}
          onOpenWorktree={onTargetSelect}
          creationOnly
          t={sidebarT}
        />
      )}
    </>
  );
}
