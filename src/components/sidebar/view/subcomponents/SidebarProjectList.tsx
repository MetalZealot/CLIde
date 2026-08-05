import { useEffect } from 'react';
import { Pin } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type {
  CheckoutSession,
  MCPServerStatus,
  RepositoryEntry,
  SessionWithProvider,
} from '../../types/types';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';

import SidebarRepositoryItem from './SidebarRepositoryItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarSectionHeader from './SidebarSectionHeader';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  /** `filteredProjects` collapsed to one row per repository (ADR 0016). */
  repositoryEntries: RepositoryEntry[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getRepositorySessions: (entry: RepositoryEntry) => CheckoutSession[];
  getVisibleSessionCount: (entryKey: string) => number;
  onShowMoreSessions: (entry: RepositoryEntry, loadedCount: number) => void;
  loadingMoreProjects: Set<string>;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  forceExpanded?: boolean;
  isRepositoryStarred: (entry: RepositoryEntry) => boolean;
  isPinnedSectionCollapsed: boolean;
  onTogglePinnedSection: () => void;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (entryKey: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (entry: RepositoryEntry) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onLongPressProjectMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onLongPressSessionMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  /** `project:<entryKey>` / `session:<sessionId>` of the row whose menu is open. */
  activeContextMenuKey?: string | null;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  repositoryEntries,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  initialSessionsLoaded,
  currentTime,
  editingSession,
  editingSessionName,
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getRepositorySessions,
  getVisibleSessionCount,
  onShowMoreSessions,
  loadingMoreProjects,
  activeSessions,
  attentionSessionIds,
  unreadSessionIds,
  forceExpanded = false,
  isRepositoryStarred,
  isPinnedSectionCollapsed,
  onTogglePinnedSection,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onLongPressProjectMenu,
  onLongPressSessionMenu,
  activeContextMenuKey,
  t,
}: SidebarProjectListProps) {
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'CLIde';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  // Pinned rows are hoisted into their own section rather than merely sorted to
  // the top, so the boundary between "what I keep" and "everything else" is
  // visible — Codex does the same with its Pinned block.
  const pinnedEntries = repositoryEntries.filter(isRepositoryStarred);
  const unpinnedEntries = repositoryEntries.filter((entry) => !isRepositoryStarred(entry));

  const renderEntry = (entry: RepositoryEntry) => (
            <SidebarRepositoryItem
              key={entry.key}
              entry={entry}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isExpanded={forceExpanded || expandedProjects.has(entry.key)}
              // The row is busy while any of its checkouts is being removed.
              isDeleting={entry.checkouts.some((checkout) =>
                deletingProjects.has(checkout.projectId),
              )}
              isStarred={isRepositoryStarred(entry)}
              editingProject={editingProject}
              editingName={editingName}
              sessions={getRepositorySessions(entry)}
              // The skeleton clears only once every checkout's sessions have
              // arrived, so a merged list never renders half-populated.
              initialSessionsLoaded={entry.checkouts.every((checkout) =>
                initialSessionsLoaded.has(checkout.projectId),
              )}
              isLoadingMoreSessions={entry.checkouts.some((checkout) =>
                loadingMoreProjects.has(checkout.projectId),
              )}
              currentTime={currentTime}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              tasksEnabled={tasksEnabled}
              mcpServerStatus={mcpServerStatus}
              onEditingNameChange={onEditingNameChange}
              onToggleProject={onToggleProject}
              onProjectSelect={onProjectSelect}
              onToggleStarProject={onToggleStarProject}
              onStartEditingProject={onStartEditingProject}
              onCancelEditingProject={onCancelEditingProject}
              onSaveProjectName={onSaveProjectName}
              onDeleteProject={onDeleteProject}
              onSessionSelect={onSessionSelect}
              onDeleteSession={onDeleteSession}
              visibleSessionCount={getVisibleSessionCount(entry.key)}
              onShowMoreSessions={onShowMoreSessions}
              activeSessions={activeSessions}
              attentionSessionIds={attentionSessionIds}
              unreadSessionIds={unreadSessionIds}
              onNewSession={onNewSession}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onLongPressProjectMenu={onLongPressProjectMenu}
              onLongPressSessionMenu={onLongPressSessionMenu}
              activeContextMenuKey={activeContextMenuKey}
              t={t}
            />
  );

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects ? (
        state
      ) : (
        <>
          {pinnedEntries.length > 0 && (
            <>
              <SidebarSectionHeader
                label={t('projects.pinned')}
                icon={Pin}
                count={pinnedEntries.length}
                isCollapsed={isPinnedSectionCollapsed}
                onToggle={onTogglePinnedSection}
              />
              {!isPinnedSectionCollapsed && pinnedEntries.map(renderEntry)}
            </>
          )}

          {/* The label is worth its line only once something sits above it. */}
          {pinnedEntries.length > 0 && unpinnedEntries.length > 0 && (
            <SidebarSectionHeader label={t('projects.title')} />
          )}
          {unpinnedEntries.map(renderEntry)}
        </>
      )}
    </div>
  );
}
