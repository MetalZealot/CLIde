import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Copy, GitBranch, Pencil, Plus, Pin, Trash2 } from 'lucide-react';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import type { Project, LLMProvider } from '../../../types/app';
import type {
  MCPServerStatus,
  RepositoryEntry,
  SidebarProps,
  SessionWithProvider,
} from '../types/types';
import type { ContextMenuAnchor } from '../../../shared/view/ui';
import { getCheckoutRefLabel, getSessionName, repositoryEntryKey } from '../utils/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import SidebarContextMenu, { type SidebarContextMenuItem } from './subcomponents/SidebarContextMenu';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  attentionSessionIds,
  unreadSessionIds,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onSessionStarPatch,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, restartRequired, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();
  const paletteOps = usePaletteOps();

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    searchFilter,
    isSearchBarOpen,
    toggleSearchBar,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    runningSessionsCount,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    repositoryEntries,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    toggleStarRepository,
    isProjectStarred,
    isRepositoryStarred,
    isPinnedSectionCollapsed,
    togglePinnedSection,
    getProjectSessions,
    getRepositorySessions,
    loadingMoreProjects,
    getVisibleSessionCount,
    showMoreSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    archiveSessionDirect,
    toggleStarSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    activeSessions,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onSessionStarPatch,
    onLoadMoreSessions,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  type SidebarMenuState =
    | { kind: 'session'; session: SessionWithProvider; anchor: ContextMenuAnchor }
    // Checkout picker for a row that merges several working trees; choosing one
    // replaces this state with the `project` menu for that checkout.
    | { kind: 'repository'; entry: RepositoryEntry; anchor: ContextMenuAnchor }
    | { kind: 'project'; project: Project; anchor: ContextMenuAnchor };
  const [contextMenu, setContextMenu] = useState<SidebarMenuState | null>(null);

  const handleLongPressSessionMenu = (session: SessionWithProvider, anchor: ContextMenuAnchor) => {
    setContextMenu({ kind: 'session', session, anchor });
  };
  // Flattening the checkouts into one row took their individual action targets
  // with it, so a merged row asks which checkout first (ADR 0016).
  const handleLongPressProjectMenu = (entry: RepositoryEntry, anchor: ContextMenuAnchor) => {
    if (entry.checkouts.length > 1) {
      setContextMenu({ kind: 'repository', entry, anchor });
      return;
    }

    setContextMenu({ kind: 'project', project: entry.leadCheckout, anchor });
  };

  // Lets the row that owns the open menu stay highlighted, so it's clear which
  // repository/session the actions apply to. Keyed by row, so drilling into a
  // checkout keeps its repository's row lit.
  const activeContextMenuKey = contextMenu
    ? contextMenu.kind === 'session'
      ? `session:${contextMenu.session.id}`
      : contextMenu.kind === 'repository'
        ? `project:${contextMenu.entry.key}`
        : `project:${repositoryEntryKey(contextMenu.project)}`
    : null;

  const contextMenuItems = useMemo<SidebarContextMenuItem[]>(() => {
    if (!contextMenu) {
      return [];
    }

    if (contextMenu.kind === 'session') {
      const { session } = contextMenu;
      const isStarred = Boolean(session.isStarred);
      const sessionName = getSessionName(session, t);
      return [
        {
          key: 'star',
          label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
          icon: Pin,
          onSelect: () => toggleStarSession(session.id, isStarred),
        },
        {
          key: 'rename',
          label: t('actions.rename'),
          icon: Pencil,
          onSelect: () => {
            setEditingSession(session.id);
            setEditingSessionName(sessionName);
          },
        },
        {
          // PWA has no URL bar, so this is the only way to see/share a session id
          // (e.g. to point a Claude session at another chat's transcript).
          key: 'copy-id',
          label: t('actions.copySessionId', 'Copy session ID'),
          icon: Copy,
          onSelect: () => {
            void copyTextToClipboard(session.id);
          },
        },
        {
          key: 'archive',
          label: t('actions.archive', 'Archive'),
          icon: Archive,
          onSelect: () => {
            void archiveSessionDirect(session.id);
          },
        },
        {
          key: 'delete',
          label: t('actions.delete'),
          icon: Trash2,
          isDanger: true,
          onSelect: () =>
            showDeleteSessionConfirmation(
              session.__projectId ?? null,
              session.id,
              sessionName,
              session.__provider,
            ),
        },
      ];
    }

    if (contextMenu.kind === 'repository') {
      const { entry, anchor } = contextMenu;
      return entry.checkouts.map((checkout) => ({
        key: `checkout:${checkout.projectId}`,
        // The branch is what tells two checkouts of one repository apart; the
        // directory name is the fallback when HEAD is detached or unreadable.
        label: getCheckoutRefLabel(checkout) ?? checkout.displayName ?? checkout.projectId,
        icon: GitBranch,
        keepOpen: true,
        onSelect: () => setContextMenu({ kind: 'project', project: checkout, anchor }),
      }));
    }

    const { project } = contextMenu;
    const isStarred = isProjectStarred(project.projectId);
    return [
      {
        // Reachable only from this menu once checkouts share a row, so it is
        // the sole way to start a session on a specific worktree.
        key: 'new-session',
        label: t('sessions.newSession'),
        icon: Plus,
        onSelect: () => {
          handleProjectSelect(project);
          onNewSession(project);
        },
      },
      {
        key: 'star',
        label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
        icon: Pin,
        onSelect: () => toggleStarProject(project.projectId),
      },
      {
        key: 'rename',
        label: t('actions.rename'),
        icon: Pencil,
        onSelect: () => startEditing(project),
      },
      {
        key: 'delete',
        label: t('actions.delete'),
        icon: Trash2,
        isDanger: true,
        onSelect: () => requestProjectDelete(project),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, t]);

  const projectListProps: SidebarProjectListProps = {
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
    loadingMoreProjects,
    activeSessions,
    attentionSessionIds,
    unreadSessionIds,
    forceExpanded: searchMode === 'running',
    isRepositoryStarred,
    isPinnedSectionCollapsed,
    onTogglePinnedSection: togglePinnedSection,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarRepository,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    getVisibleSessionCount,
    onShowMoreSessions: showMoreSessions,
    onNewSession,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onLongPressProjectMenu: handleLongPressProjectMenu,
    onLongPressSessionMenu: handleLongPressSessionMenu,
    activeContextMenuKey,
    t,
  };

  return (
    <>
        {contextMenu && (
          <SidebarContextMenu
            anchor={contextMenu.anchor}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
          />
        )}

        <SidebarModals
          projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          updateAvailable={updateAvailable}
          restartRequired={restartRequired}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <>
        <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            runningSessionsCount={runningSessionsCount}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            isSearchBarOpen={isSearchBarOpen}
            onToggleSearchBar={toggleSearchBar}
            searchMode={searchMode}
            onSearchModeChange={(mode) => {
              setSearchMode(mode);
              if (mode === 'projects') clearConversationResults();
            }}
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onRestoreArchivedProject={restoreArchivedProject}
            onArchivedSessionClick={openArchivedSession}
            onRestoreArchivedSession={restoreArchivedSession}
            onDeleteArchivedSession={(session) => {
              showDeleteSessionConfirmation(
                session.projectId,
                session.sessionId,
                session.sessionTitle,
                session.provider,
                { isArchived: true },
              );
            }}
            onConversationResultClick={(projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => {
              // `projectId` (DB key) is the canonical identifier post-migration.
              // The server emits null when it can't resolve a project row for
              // the search hit; treat that as "no project" and still navigate
              // to the session so the user can open it from the URL.
              const resolvedProvider = (provider || 'claude') as LLMProvider;
              const project = projectId ? projects.find(p => p.projectId === projectId) : null;
              const searchTarget = { __searchTargetTimestamp: messageTimestamp || null, __searchTargetSnippet: messageSnippet || null };
              const sessionObj = {
                id: sessionId,
                __provider: resolvedProvider,
                __projectId: projectId ?? undefined,
                ...searchTarget,
              };
              if (project) {
                handleProjectSelect(project);
                const sessions = getProjectSessions(project);
                const existing = sessions.find(s => s.id === sessionId);
                if (existing) {
                  handleSessionClick({ ...existing, ...searchTarget }, project.projectId);
                } else {
                  handleSessionClick(sessionObj, project.projectId);
                }
              } else {
                handleSessionClick(sessionObj, projectId ?? '');
              }
            }}
            onCreateProject={() => setShowNewProject(true)}
            onCollapseSidebar={handleCollapseSidebar}
            updateAvailable={updateAvailable}
            restartRequired={restartRequired}
            releaseInfo={releaseInfo}
            latestVersion={latestVersion}
            currentVersion={currentVersion}
            onShowVersionModal={() => setShowVersionModal(true)}
            onShowSettings={onShowSettings}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
