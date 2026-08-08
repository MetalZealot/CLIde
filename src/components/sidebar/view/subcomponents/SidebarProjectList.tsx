import { useEffect } from 'react';
import { Loader2, Pin, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type {
  ActivitySession,
  ActivitySummary,
  CheckoutSession,
  MCPServerStatus,
  PinnedSession,
  RepositoryEntry,
  RepositoryViewOptions,
  SessionWithProvider,
} from '../../types/types';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';

import SidebarRepositoryItem from './SidebarRepositoryItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarSectionHeader from './SidebarSectionHeader';
import SidebarSessionItem from './SidebarSessionItem';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  /** `filteredProjects` collapsed to one row per repository (ADR 0016). */
  repositoryEntries: RepositoryEntry[];
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
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
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
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteRepository: (entry: RepositoryEntry) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onNewSession: (project: Project) => void;
  onNewSessionMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onNewWorktree?: (entry: RepositoryEntry) => void;
  getRepositoryView: (entryKey: string) => RepositoryViewOptions;
  onOpenViewMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onCreateProject: () => void;
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
  tasksEnabled,
  mcpServerStatus,
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
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteRepository,
  onSessionSelect,
  onDeleteSession,
  onNewSession,
  onNewSessionMenu,
  onNewWorktree,
  getRepositoryView,
  onOpenViewMenu,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onCreateProject,
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
      tasksEnabled={tasksEnabled}
      mcpServerStatus={mcpServerStatus}
      onEditingNameChange={onEditingNameChange}
      onToggleProject={onToggleProject}
      onProjectSelect={onProjectSelect}
      onStartEditingProject={onStartEditingProject}
      onCancelEditingProject={onCancelEditingProject}
      onSaveProjectName={onSaveProjectName}
      onDeleteRepository={onDeleteRepository}
      onSessionSelect={onSessionSelect}
      onDeleteSession={onDeleteSession}
      visibleSessionCount={getVisibleSessionCount(entry.key)}
      onShowAllSessions={onShowAllSessions}
      onCollapseSessions={onCollapseSessions}
      activeSessions={activeSessions}
      attentionSessionIds={attentionSessionIds}
      unreadSessionIds={unreadSessionIds}
      onNewSession={onNewSession}
      onNewSessionMenu={onNewSessionMenu}
      onNewWorktree={onNewWorktree}
      viewOptions={getRepositoryView(entry.key)}
      onOpenViewMenu={onOpenViewMenu}
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

  /** A flat-section session labelled with the repository it belongs to. */
  const renderSectionSession = (
    { session, checkout, branchLabel, repositoryName }: PinnedSession | ActivitySession,
    facet: 'activity' | 'pinned',
  ) => (
    <SidebarSessionItem
      key={`${facet}:${session.id}`}
      project={checkout}
      session={session}
      projectLabel={repositoryName}
      branchLabel={branchLabel}
      selectedSession={selectedSession}
      isProcessing={activeSessions.has(session.id)}
      needsAttention={attentionSessionIds.has(session.id)}
      isUnread={unreadSessionIds.has(session.id)}
      currentTime={currentTime}
      editingSession={editingSession}
      editingSessionName={editingSessionName}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onStartEditingSession={onStartEditingSession}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      onProjectSelect={onProjectSelect}
      onSessionSelect={onSessionSelect}
      onDeleteSession={onDeleteSession}
      onLongPressMenu={onLongPressSessionMenu}
      activeContextMenuKey={activeContextMenuKey}
      t={t}
    />
  );

  const showActivitySection = showProjects && activitySessions.length > 0;
  const showPinnedSection = showProjects && pinnedSessions.length > 0;
  const activitySummaryNode = (
    <span className="ml-auto flex flex-shrink-0 items-center gap-2 normal-case tracking-normal">
      {activitySummary.blocked > 0 && (
        <span className="flex items-center gap-1 tabular-nums text-amber-600 dark:text-amber-400" title={t('projects.activityBlocked', 'Blocked')}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {activitySummary.blocked}
        </span>
      )}
      {activitySummary.unread > 0 && (
        <span className="flex items-center gap-1 tabular-nums text-green-600 dark:text-green-400" title={t('projects.activityUnread', 'Unread finished')}>
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {activitySummary.unread}
        </span>
      )}
      {activitySummary.running > 0 && (
        <span className="flex items-center gap-1 tabular-nums text-muted-foreground" title={t('projects.activityRunning', 'Running')}>
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          {activitySummary.running}
        </span>
      )}
    </span>
  );

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {/*
        Activity is a transient copy while Pinned is a durable move. The
        "Projects" label appears only when either flat section needs separating
        from the repository rows below it.
      */}
      {showActivitySection && (
        <>
          <SidebarSectionHeader
            label={t('projects.activity')}
            summary={activitySummaryNode}
            isCollapsed={isActivitySectionCollapsed}
            onToggle={onToggleActivitySection}
          />
          {!isActivitySectionCollapsed && activitySessions.map((session) => renderSectionSession(session, 'activity'))}
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
          {!isPinnedSectionCollapsed && pinnedSessions.map((session) => renderSectionSession(session, 'pinned'))}
        </>
      )}

      {(showActivitySection || showPinnedSection) && <SidebarSectionHeader label={t('projects.title')} />}

      {!showProjects ? state : repositoryEntries.map(renderEntry)}

      {/*
        Creating a project is the last thing in the list it adds to, faded
        because it is an affordance rather than a project. It stays visible even
        with no projects at all — that is when it matters most.
      */}
      {!isLoading && (
        <button
          type="button"
          onClick={onCreateProject}
          className="flex w-full items-center gap-2 rounded-md px-4 py-2.5 text-left text-sm text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground active:bg-accent/50 md:px-3 md:py-2"
        >
          <Plus className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{t('projects.newProject')}</span>
        </button>
      )}
    </div>
  );
}
