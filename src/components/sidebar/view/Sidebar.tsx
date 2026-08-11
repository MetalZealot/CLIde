import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Copy, MessageSquare, Palette, Pencil, Pin, Trash2, TreeDeciduous } from 'lucide-react';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { Project, LLMProvider } from '../../../types/app';
import type {
  RepositoryEntry,
  SidebarProps,
  SessionWithProvider,
} from '../types/types';
import type { ContextMenuAnchor } from '../../../shared/view/ui';
import { getSessionName } from '../utils/utils';
import { readProjectAccentColor, type ProjectAccentColor } from '../utils/accentColors';
import { copyTextToClipboard } from '../../../utils/clipboard';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import SidebarContextMenu, { type SidebarContextMenuItem } from './subcomponents/SidebarContextMenu';
import SidebarAccentColorMenu from './subcomponents/SidebarAccentColorMenu';
import SidebarSessionViewMenu from './subcomponents/SidebarSessionViewMenu';
import WorktreeManagerModal from './subcomponents/WorktreeManagerModal';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
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
  onOpenNewSession,
  onNewSession,
  onCreateWorktree,
  onAdoptCheckout,
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
  onCloseSidebar,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, restartRequired, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;
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
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    repositoryEntries,
    projectPickerEntries,
    projectFilterKey,
    selectProjectFilter,
    activitySessions,
    activitySummary,
    isActivitySectionCollapsed,
    toggleActivitySection,
    pinnedSessions,
    isPinnedSectionCollapsed,
    togglePinnedSection,
    isSessionSearchActive,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    toggleProject,
    handleSessionClick,
    getProjectSessions,
    getRepositorySessions,
    getRepositoryView,
    setRepositoryView,
    resetRepositoryView,
    loadingMoreProjects,
    getVisibleSessionCount,
    showAllSessions,
    collapseSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    archiveSessionDirect,
    toggleStarSession,
    requestProjectDelete,
    requestRepositoryDelete,
    archiveProjects,
    renameProjectDirect,
    setProjectAccentColor,
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
    attentionSessionIds,
    unreadSessionIds,
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
    // The row's own actions: repository-scoped, plus the way into the worktree
    // manager. Not a worktree picker — that step used to stand between the user
    // and every action on the row.
    | { kind: 'repository'; entry: RepositoryEntry; anchor: ContextMenuAnchor }
    | { kind: 'create'; entry: RepositoryEntry; anchor: ContextMenuAnchor };
  const [contextMenu, setContextMenu] = useState<SidebarMenuState | null>(null);
  // `mode` decides whether the manager opens on its list or its create form.
  const [worktreeManager, setWorktreeManager] = useState<
    { entry: RepositoryEntry; mode: 'manage' | 'create'; openCreatedInNewSession: boolean } | null
  >(null);
  const [viewMenu, setViewMenu] = useState<
    { entry: RepositoryEntry; anchor: ContextMenuAnchor } | null
  >(null);
  // The highlight-colour picker, opened from Customize. It reuses the anchor the
  // project menu was opened at, so it appears where that menu just was rather
  // than jumping to a different part of the row.
  const [accentColorMenu, setAccentColorMenu] = useState<
    { entry: RepositoryEntry; anchor: ContextMenuAnchor } | null
  >(null);

  // Long-press, the row's kebab, and right-click all land here: the anchor is
  // the only thing that differs, so every entry point shares one menu.
  const handleSessionActionsMenu = (session: SessionWithProvider, anchor: ContextMenuAnchor) => {
    setContextMenu({ kind: 'session', session, anchor });
  };

  const handleProjectActionsMenu = (entry: RepositoryEntry, anchor: ContextMenuAnchor) => {
    setContextMenu({ kind: 'repository', entry, anchor });
  };

  const handleCreateMenu = (entry: RepositoryEntry, anchor: ContextMenuAnchor) => {
    setContextMenu({ kind: 'create', entry, anchor });
  };

  /**
   * The open manager follows the live entry rather than the one captured when
   * it opened, so creating or removing a worktree updates the list in place.
   */
  const activeWorktreeEntry = worktreeManager
    ? repositoryEntries.find(
        (entry) => entry.key === worktreeManager.entry.key && entry.repositoryId !== null,
      ) ?? null
    : null;

  /**
   * The open menu follows the live entry too, so adding a worktree while it is
   * open adds a row to its filter list instead of leaving a stale one.
   */
  const activeViewMenuEntry = viewMenu
    ? repositoryEntries.find((entry) => entry.key === viewMenu.entry.key) ?? null
    : null;

  // Follows the live entry as well, so the swatch check mark moves to the
  // colour just picked instead of the one the menu opened with.
  const activeAccentColorMenuEntry = accentColorMenu
    ? repositoryEntries.find((entry) => entry.key === accentColorMenu.entry.key) ?? null
    : null;

  // Lets the row that owns the open menu stay highlighted, so it's clear which
  // repository/session the actions apply to.
  const activeContextMenuKey = contextMenu
    ? contextMenu.kind === 'session'
      ? `session:${contextMenu.session.id}`
      : contextMenu.kind === 'repository'
        ? `project:${contextMenu.entry.key}`
        : null
    : null;

  // Names the menu after the row it acts on, so a screen reader announces which
  // of many identical-sounding menus just opened.
  const contextMenuAriaLabel = contextMenu
    ? contextMenu.kind === 'session'
      ? t('actions.rowActions', 'Actions for {{name}}', { name: getSessionName(contextMenu.session, t) })
      : contextMenu.kind === 'create'
        ? t('projects.createMenu', 'Create in project')
        : t('actions.rowActions', 'Actions for {{name}}', { name: contextMenu.entry.displayName })
    : undefined;

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
          // Splits the reversible edits above from the ones that remove the
          // session from the list.
          showDividerBefore: true,
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

    if (contextMenu.kind === 'create') {
      const { entry } = contextMenu;
      return [
        {
          key: 'new-session',
          label: t('sessions.newSession'),
          icon: MessageSquare,
          onSelect: () => onNewSession(entry.leadCheckout),
        },
        ...(entry.repositoryId
          ? [
              {
                key: 'new-worktree',
                label: t('worktrees.new', 'New Worktree'),
                icon: TreeDeciduous,
                onSelect: () => setWorktreeManager({
                  entry,
                  mode: 'create',
                  openCreatedInNewSession: true,
                }),
              },
            ]
          : []),
      ];
    }

    const { entry } = contextMenu;
    return [
      {
        // Renaming relabels the row, which is the lead worktree's display name.
        // Renaming a *particular* worktree is a job for the manager below.
        key: 'rename',
        label: t('actions.rename'),
        icon: Pencil,
        onSelect: () => startEditing(entry.leadCheckout),
      },
      {
        // Customization follows rename's rule and targets the lead checkout, so
        // one repository row carries one identity however many worktrees it has.
        key: 'customize',
        label: t('actions.customize', 'Customize'),
        icon: Palette,
        onSelect: () => setAccentColorMenu({ entry, anchor: contextMenu.anchor }),
      },
      // Offered only for an actual git checkout root. A plain folder project has
      // no repository to add a worktree to, and the manager's create form would
      // only fail server-side with "Not a git repository".
      ...(entry.repositoryId
        ? [
            {
              key: 'worktrees',
              label: t('worktrees.title', 'Worktrees'),
              icon: TreeDeciduous,
              onSelect: () => setWorktreeManager({
                entry,
                mode: 'manage',
                openCreatedInNewSession: false,
              }),
            },
          ]
        : []),
      {
        // Reversible from the Archive view, so it needs no confirmation of its
        // own — unlike Delete, which opens the modal.
        showDividerBefore: true,
        key: 'archive',
        label: t('actions.archive', 'Archive'),
        icon: Archive,
        onSelect: () => archiveProjects(entry.checkouts),
      },
      {
        key: 'delete',
        label: t('actions.delete'),
        icon: Trash2,
        isDanger: true,
        onSelect: () => requestRepositoryDelete(entry),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, t]);

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    repositoryEntries,
    projectPickerEntries,
    projectFilterKey,
    onProjectFilterSelect: selectProjectFilter,
    activitySessions,
    activitySummary,
    isActivitySectionCollapsed,
    onToggleActivitySection: toggleActivitySection,
    pinnedSessions,
    isPinnedSectionCollapsed,
    onTogglePinnedSection: togglePinnedSection,
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
    loadingMoreProjects,
    activeSessions,
    attentionSessionIds,
    unreadSessionIds,
    // A search narrows each row to its matching sessions, so the rows have to
    // open to show them.
    forceExpanded: isSessionSearchActive,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onSessionSelect: handleSessionClick,
    getVisibleSessionCount,
    onShowAllSessions: showAllSessions,
    onCollapseSessions: collapseSessions,
    onOpenCreateMenu: handleCreateMenu,
    getRepositoryView,
    onOpenViewMenu: (entry: RepositoryEntry, anchor: ContextMenuAnchor) =>
      setViewMenu({ entry, anchor }),
    onCreateProject: () => setShowNewProject(true),
    onEditingSessionNameChange: setEditingSessionName,
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onOpenProjectActionsMenu: handleProjectActionsMenu,
    onOpenSessionActionsMenu: handleSessionActionsMenu,
    activeContextMenuKey,
    t,
  };

  return (
    <>
        {contextMenu && (
          <SidebarContextMenu
            anchor={contextMenu.anchor}
            items={contextMenuItems}
            ariaLabel={contextMenuAriaLabel}
            onClose={() => setContextMenu(null)}
          />
        )}

        {activeViewMenuEntry && viewMenu && (
          <SidebarSessionViewMenu
            entry={activeViewMenuEntry}
            anchor={viewMenu.anchor}
            options={getRepositoryView(activeViewMenuEntry.key)}
            onChange={(options) => setRepositoryView(activeViewMenuEntry.key, options)}
            onReset={() => resetRepositoryView(activeViewMenuEntry.key)}
            onClose={() => setViewMenu(null)}
            t={t}
          />
        )}

        {activeAccentColorMenuEntry && accentColorMenu && (
          <SidebarAccentColorMenu
            anchor={accentColorMenu.anchor}
            accentColor={readProjectAccentColor(activeAccentColorMenuEntry.leadCheckout.accentColor)}
            onSelect={(nextAccentColor: ProjectAccentColor | null) =>
              setProjectAccentColor(
                activeAccentColorMenuEntry.leadCheckout.projectId,
                nextAccentColor,
                readProjectAccentColor(activeAccentColorMenuEntry.leadCheckout.accentColor),
              )
            }
            onClose={() => setAccentColorMenu(null)}
            t={t}
          />
        )}

        {activeWorktreeEntry && worktreeManager && (
          <WorktreeManagerModal
            entry={activeWorktreeEntry}
            onClose={() => setWorktreeManager(null)}
            onRenameWorktree={renameProjectDirect}
            onArchiveWorktree={(project) => archiveProjects([project])}
            onRemoveWorktree={requestProjectDelete}
            onCreateWorktree={onCreateWorktree}
            onAdoptCheckout={onAdoptCheckout}
            onOpenWorktree={worktreeManager.openCreatedInNewSession ? onNewSession : handleProjectSelect}
            startInCreate={worktreeManager.mode === 'create'}
            t={t}
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
          activitySummary={activitySummary}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <>
        <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
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
            onCollapseSidebar={isMobile && onCloseSidebar ? onCloseSidebar : handleCollapseSidebar}
            onOpenNewSession={onOpenNewSession}
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
