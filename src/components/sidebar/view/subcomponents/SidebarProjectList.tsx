import { useEffect } from 'react';
import { Activity, FolderPlus, Pin } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type {
  ActivitySession,
  ActivityState,
  ActivitySummary,
  BrowseSession,
  CheckoutSession,
  PinnedSession,
  RepositoryEntry,
  RepositoryViewOptions,
  SidebarBrowseMode,
  SessionWithProvider,
} from '../../types/types';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';

import SidebarRepositoryItem from './SidebarRepositoryItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarSectionHeader from './SidebarSectionHeader';
import SidebarSessionItem from './SidebarSessionItem';
import SidebarStatusIndicator from './SidebarStatusIndicator';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  /** `filteredProjects` collapsed to one row per repository (ADR 0016). */
  repositoryEntries: RepositoryEntry[];
  browseMode: SidebarBrowseMode;
  browseSessions: BrowseSession[];
  /** Pinned sessions, which live here instead of inside their own row. */
  pinnedSessions: PinnedSession[];
  /** Transient activity is copied here and remains inside repository rows. */
  activitySessions: ActivitySession[];
  activitySummary: ActivitySummary;
  isActivitySectionCollapsed: boolean;
  onToggleActivitySection: () => void;
  isPinnedSectionCollapsed: boolean;
  onTogglePinnedSection: () => void;
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
  getRepositorySessions: (entry: RepositoryEntry) => CheckoutSession[];
  getVisibleSessionCount: (entryKey: string) => number;
  onShowAllSessions: (entry: RepositoryEntry) => void;
  onCollapseSessions: (entry: RepositoryEntry) => void;
  loadingMoreProjects: Set<string>;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  forceExpanded?: boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (entryKey: string) => void;
  onProjectSelect: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  getRepositoryView: (entryKey: string) => RepositoryViewOptions;
  onOpenViewMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onEditingSessionNameChange: (value: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onCreateProject: () => void;
  onOpenProjectActionsMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  /** `entryKey` is absent for the flat Activity/Pinned rows, which own no list. */
  onOpenSessionActionsMenu?: (
    session: SessionWithProvider,
    anchor: ContextMenuAnchor,
    entryKey?: string,
  ) => void;
  /** `project:<entryKey>` / `session:<sessionId>` of the row whose menu is open. */
  activeContextMenuKey?: string | null;
  /** The one repository row in batch mode, and what is ticked in it. */
  sessionSelection: { entryKey: string; ids: ReadonlySet<string> } | null;
  onToggleBatchSelected: (sessionId: string) => void;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  repositoryEntries,
  browseMode,
  browseSessions,
  activitySessions,
  activitySummary,
  isActivitySectionCollapsed,
  onToggleActivitySection,
  pinnedSessions,
  isPinnedSectionCollapsed,
  onTogglePinnedSection,
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
  getRepositorySessions,
  getVisibleSessionCount,
  onShowAllSessions,
  onCollapseSessions,
  loadingMoreProjects,
  activeSessions,
  attentionSessionIds,
  unreadSessionIds,
  forceExpanded = false,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onCancelEditingProject,
  onSaveProjectName,
  onSessionSelect,
  getRepositoryView,
  onOpenViewMenu,
  onEditingSessionNameChange,
  onCancelEditingSession,
  onSaveEditingSession,
  onCreateProject,
  onOpenProjectActionsMenu,
  onOpenSessionActionsMenu,
  activeContextMenuKey,
  sessionSelection,
  onToggleBatchSelected,
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
      onEditingNameChange={onEditingNameChange}
      onToggleProject={onToggleProject}
      onProjectSelect={onProjectSelect}
      onCancelEditingProject={onCancelEditingProject}
      onSaveProjectName={onSaveProjectName}
      onSessionSelect={onSessionSelect}
      visibleSessionCount={getVisibleSessionCount(entry.key)}
      onShowAllSessions={onShowAllSessions}
      onCollapseSessions={onCollapseSessions}
      activeSessions={activeSessions}
      attentionSessionIds={attentionSessionIds}
      unreadSessionIds={unreadSessionIds}
      viewOptions={getRepositoryView(entry.key)}
      onOpenViewMenu={onOpenViewMenu}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      onOpenProjectActionsMenu={onOpenProjectActionsMenu}
      onOpenSessionActionsMenu={onOpenSessionActionsMenu}
      activeContextMenuKey={activeContextMenuKey}
      batchSelectedIds={sessionSelection?.entryKey === entry.key ? sessionSelection.ids : null}
      onToggleBatchSelected={onToggleBatchSelected}
      t={t}
    />
  );

  /** A flat-section session labelled with the repository it belongs to. */
  const renderFlatSession = (
    { session, checkout, branchLabel, repositoryName }: PinnedSession | ActivitySession | BrowseSession,
    facet: 'activity' | 'pinned' | 'browse',
  ) => (
    <SidebarSessionItem
      key={`${facet}:${session.id}`}
      project={checkout}
      session={session}
      projectLabel={repositoryName}
      branchLabel={branchLabel}
      isSectionItem
      selectedSession={selectedSession}
      isProcessing={activeSessions.has(session.id)}
      needsAttention={attentionSessionIds.has(session.id)}
      isUnread={unreadSessionIds.has(session.id)}
      currentTime={currentTime}
      editingSession={editingSession}
      editingSessionName={editingSessionName}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      onProjectSelect={onProjectSelect}
      onSessionSelect={onSessionSelect}
      onOpenActionsMenu={onOpenSessionActionsMenu}
      activeContextMenuKey={activeContextMenuKey}
      t={t}
    />
  );

  const showActivitySection = showProjects && activitySessions.length > 0;
  const showPinnedSection = showProjects && pinnedSessions.length > 0;
  const activityStates: ActivityState[] = ['blocked', 'running', 'unread'];
  const activitySummaryNode = (
    <span className="ml-auto flex flex-shrink-0 items-center gap-2 normal-case tracking-normal">
      {activityStates.map((status) => activitySummary[status] > 0 && (
        <span key={status} className="flex items-center gap-0.5 tabular-nums text-muted-foreground">
          <SidebarStatusIndicator status={status} t={t} size="xs" />
          {activitySummary[status]}
        </span>
      ))}
    </span>
  );

  return (
    <div className="md:space-y-1">
      {/*
        Activity is a transient copy while Pinned is a durable move. The
        browse mode changes only the list below it; the two global sections
        keep background status and durable shortcuts visible.
      */}
      {showActivitySection && (
        <>
          <SidebarSectionHeader
            label={t('projects.activity')}
            icon={Activity}
            summary={activitySummaryNode}
            isCollapsed={isActivitySectionCollapsed}
            onToggle={onToggleActivitySection}
          />
          {!isActivitySectionCollapsed && activitySessions.map((session) => renderFlatSession(session, 'activity'))}
        </>
      )}

      {showPinnedSection && (
        <>
          <SidebarSectionHeader
            label={t('projects.starred')}
            icon={Pin}
            count={pinnedSessions.length}
            isCollapsed={isPinnedSectionCollapsed}
            onToggle={onTogglePinnedSection}
          />
          {!isPinnedSectionCollapsed && pinnedSessions.map((session) => renderFlatSession(session, 'pinned'))}
        </>
      )}

      {!showProjects ? state : browseMode === 'projects' ? (
        repositoryEntries.map(renderEntry)
      ) : browseSessions.length > 0 ? (
        browseSessions.map((session) => renderFlatSession(session, 'browse'))
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t('sessions.noSessions')}
        </div>
      )}

      {/*
        Creating a project is the last thing in the list it adds to, faded
        because it is an affordance rather than a project. It stays visible even
        with no projects at all — that is when it matters most.
      */}
      {!isLoading && browseMode === 'projects' && (
        <button
          type="button"
          onClick={onCreateProject}
          className="flex w-full items-center gap-2 rounded-md px-4 py-2.5 text-left text-sm text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground active:bg-accent/50 md:px-3 md:py-2"
        >
          <FolderPlus className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{t('projects.newProject')}</span>
        </button>
      )}
    </div>
  );
}
