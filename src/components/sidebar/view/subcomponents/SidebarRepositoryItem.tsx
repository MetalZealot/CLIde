import { useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, Edit3, GitBranch, ListFilter, TreeDeciduous, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, anchorFromElement, type ContextMenuAnchor } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type {
  CheckoutSession,
  MCPServerStatus,
  RepositoryEntry,
  RepositoryViewOptions,
  SessionWithProvider,
} from '../../types/types';
import { getCheckoutRefLabel, getTaskIndicatorStatus, isDefaultRepositoryView } from '../../utils/utils';
import { useLongPress } from '../../../../hooks/useLongPress';

import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarRepositoryItemProps = {
  entry: RepositoryEntry;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: CheckoutSession[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
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
  visibleSessionCount: number;
  onShowAllSessions: (entry: RepositoryEntry) => void;
  onCollapseSessions: (entry: RepositoryEntry) => void;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onNewSessionMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onNewWorktree?: (entry: RepositoryEntry) => void;
  /** How this row is currently sorted and filtered. */
  viewOptions: RepositoryViewOptions;
  onOpenViewMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onLongPressProjectMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onLongPressSessionMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  activeContextMenuKey?: string | null;
  t: TFunction;
};

/**
 * Total across every checkout the row covers, so the count still matches the
 * list it opens. `sessionMeta.total` is the server's count including sessions
 * not yet paginated in.
 *
 * Pinned sessions are subtracted: they were moved into the Pinned section, and
 * counting them here would promise rows the list no longer holds. Counting them
 * off the loaded page is exact, because the server orders `isStarred DESC` and
 * so never leaves a pinned session behind pagination.
 */
const getSessionCountDisplay = (
  entry: RepositoryEntry,
  sessions: CheckoutSession[],
  hasCustomView: boolean,
): number => {
  // A sorted or filtered row has already loaded every session it holds, and
  // its list is the filtered one. The server's total describes the unfiltered
  // set, so using it here would promise rows the filter has removed.
  if (hasCustomView) {
    return sessions.length;
  }

  const hasServerTotals = entry.checkouts.some(
    (checkout) => typeof checkout.sessionMeta?.total === 'number',
  );

  if (!hasServerTotals) {
    return sessions.length;
  }

  return entry.checkouts.reduce((total, checkout) => {
    const pinnedCount = (checkout.sessions ?? []).filter((session) => session.isStarred).length;
    return total + Number(checkout.sessionMeta?.total ?? 0) - pinnedCount;
  }, 0);
};

/**
 * One repository, one row (ADR 0016).
 *
 * For the ordinary single-checkout project this is the project row it always
 * was. When a repository has several registered checkouts it becomes the
 * repository's row: the sessions beneath it are merged across those checkouts
 * and labelled with their branch, and repository-scoped actions target the lead
 * checkout. Per-checkout actions live in the long-press menu.
 */
export default function SidebarRepositoryItem({
  entry,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteRepository,
  onSessionSelect,
  onDeleteSession,
  visibleSessionCount,
  onShowAllSessions,
  onCollapseSessions,
  activeSessions,
  unreadSessionIds,
  attentionSessionIds,
  onNewSession,
  onNewSessionMenu,
  onNewWorktree,
  viewOptions,
  onOpenViewMenu,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onLongPressProjectMenu,
  onLongPressSessionMenu,
  activeContextMenuKey,
  t,
}: SidebarRepositoryItemProps) {
  // Rename and task status act on the lead checkout — the main working tree
  // when it is registered. Delete covers the whole repository, because the row
  // is the repository and would otherwise leave its other worktrees stranded.
  const project = entry.leadCheckout;
  const isMerged = entry.checkouts.length > 1;
  // Any checkout being current lights the row, since they share it.
  const isSelected = entry.checkouts.some(
    (checkout) => selectedProject?.projectId === checkout.projectId,
  );
  const isEditing = editingProject === project.projectId;
  // Drives the header control's lit state, so a row you filtered and navigated
  // away from still says so when you come back to it.
  const hasCustomView = !isDefaultRepositoryView(viewOptions);
  const totalSessionCount = getSessionCountDisplay(entry, sessions, hasCustomView);
  const sessionCountLabel = `${totalSessionCount} session${totalSessionCount === 1 ? '' : 's'}`;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  // A merged row names its checkouts instead of a branch: it has several, and
  // each session below already carries the one it belongs to.
  const rowSubtitle = isMerged
    ? t('projects.repositoryCheckouts', {
        count: entry.checkouts.length,
        defaultValue_one: '{{count}} worktree',
        defaultValue: '{{count}} worktrees',
      })
    : getCheckoutRefLabel(project);
  // ADR 0016: a branch and a checkout never share an icon. The subtitle is a
  // branch only on an unmerged row; on a merged one it counts worktrees.
  const RowSubtitleIcon = isMerged ? TreeDeciduous : GitBranch;
  // Surface a collapsed row from its loaded sessions: amber if any child is
  // blocked on the user, else green if any child has unread finished output.
  // (Sessions not yet paginated in can't be mapped here; they light up once the
  // row is expanded and their sessions load.)
  const projectNeedsAttention = sessions.some(({ session }) => attentionSessionIds.has(session.id));
  const projectHasUnread = sessions.some(({ session }) => unreadSessionIds.has(session.id));

  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const mobileViewMenuRef = useRef<HTMLDivElement>(null);
  const desktopViewMenuRef = useRef<HTMLDivElement>(null);

  /**
   * The control lives in the header rather than beside New Session because the
   * header is what stays on screen: it is all that remains when the row is
   * collapsed, and it sticks to the top while a long list scrolls under it —
   * which is exactly when a forgotten filter needs to keep announcing itself.
   */
  const openViewMenu = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    onOpenViewMenu?.(
      entry,
      anchorFromElement(element, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }),
    );
  };

  /**
   * Shown once the row is open and its sessions are on screen: there is nothing
   * to sort while the list is shut, and an always-present control on every row
   * is clutter on a sidebar that is mostly collapsed rows.
   *
   * A row you filtered and then collapsed keeps it, lit — with the list hidden
   * the control is the only thing left saying the row is not showing everything.
   */
  const showViewMenu = Boolean(onOpenViewMenu) && (isExpanded || hasCustomView);

  const viewMenuClasses = cn(
    'flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-200',
    hasCustomView ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
  );

  useEffect(() => {
    if (!isEditing || !mobileRenameInputRef.current) {
      return;
    }

    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        mobileRenameInputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    };

    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const toggleProject = () => onToggleProject(entry.key);
  // Anchor the menu to the row's box, not the finger, so it opens attached to
  // the repository it acts on.
  const mobileRowRef = useRef<HTMLDivElement>(null);
  const { handlers: longPress, isPressing } = useLongPress(
    (coords) => onLongPressProjectMenu?.(entry, anchorFromElement(mobileRowRef.current, coords)),
    { disabled: !onLongPressProjectMenu },
  );
  // Stays on for as long as this row's menu is open.
  const isContextActive = isPressing || activeContextMenuKey === `project:${entry.key}`;

  const saveProjectName = () => {
    onSaveProjectName(project.projectId);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      {/*
        While the row is open its header pins to the top of the scroll area, so
        a long merged session list can be collapsed again without scrolling back
        up to find its own header. Sticky lives on this wrapper rather than the
        row itself: the wrapper's parent also contains the session list, which
        is the distance the header needs to travel.
      */}
      <div className={cn('md:group group', isExpanded && 'sticky top-0 z-10 bg-background')}>
        <div className="md:hidden">
          <div
            ref={mobileRowRef}
            className={cn(
              // No resting card — see SidebarSessionItem for the reasoning.
              // The row keeps an opaque background only while it is stuck to
              // the top, so scrolled content cannot show through it.
              'long-pressable p-2 mx-3 my-0.5 rounded-lg transition-all duration-150',
              isContextActive && 'scale-[0.98] bg-accent/60',
              isSelected && 'bg-primary/10',
              projectNeedsAttention && !isSelected && 'bg-amber-500/10',
              projectHasUnread && !isSelected && !projectNeedsAttention && 'bg-green-500/10',
              !isSelected && !projectNeedsAttention && !projectHasUnread && 'active:bg-accent/50',
            )}
            onClick={toggleProject}
            {...longPress}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={mobileRenameInputRef}
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <h3 className="truncate text-sm font-normal text-foreground">{entry.displayName}</h3>
                        </div>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="flex-shrink-0">{sessionCountLabel}</span>
                        {rowSubtitle && (
                          <>
                            <RowSubtitleIcon className="h-3 w-3 flex-shrink-0 opacity-60" />
                            <span className="truncate" title={rowSubtitle}>
                              {rowSubtitle}
                            </span>
                          </>
                        )}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    {showViewMenu && (
                      <div
                        ref={mobileViewMenuRef}
                        className={viewMenuClasses}
                        onClick={(event) => {
                          event.stopPropagation();
                          openViewMenu(mobileViewMenuRef.current);
                        }}
                      >
                        <ListFilter className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className="flex h-6 w-6 items-center justify-center">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden md:flex w-full justify-between p-2 h-auto font-normal hover:bg-accent/50',
            isSelected && 'bg-primary/10',
            projectNeedsAttention && !isSelected && 'bg-amber-500/10 hover:bg-amber-500/20',
            projectHasUnread &&
              !isSelected &&
              !projectNeedsAttention &&
              'bg-green-500/10 hover:bg-green-500/20',
          )}
          onClick={selectAndToggleProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="truncate text-sm font-normal text-foreground" title={entry.displayName}>
                    {entry.displayName}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="flex-shrink-0">{totalSessionCount}</span>
                    {rowSubtitle ? (
                      // The branch (or the checkout count) is the more useful
                      // identifier than the path — none of the reference clients
                      // in `docs/ui ref/` show a filesystem path at all.
                      <>
                        <RowSubtitleIcon className="h-3 w-3 flex-shrink-0 opacity-60" />
                        <span className="truncate opacity-80" title={`${rowSubtitle} — ${project.fullPath}`}>
                          {rowSubtitle}
                        </span>
                      </>
                    ) : (
                      project.fullPath !== entry.displayName && (
                        <span className="truncate opacity-60" title={project.fullPath}>
                          {' - '}
                          {project.fullPath.length > 25 ? `...${project.fullPath.slice(-22)}` : project.fullPath}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                {/*
                  A div, not a button: the desktop header is itself a <button>,
                  so a nested one would be invalid markup. Same shape the rename
                  and delete controls beside it already use.
                */}
                {showViewMenu && (
                  <div
                    ref={desktopViewMenuRef}
                    className={viewMenuClasses}
                    onClick={(event) => {
                      event.stopPropagation();
                      openViewMenu(desktopViewMenuRef.current);
                    }}
                    title={t('sessionView.title', 'Sort and filter sessions')}
                  >
                    <ListFilter className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-accent group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingProject(project);
                  }}
                  title={t('tooltips.renameProject')}
                >
                  <Edit3 className="h-3 w-3" />
                </div>
                <div
                  className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRepository(entry);
                  }}
                  title={t('tooltips.deleteProject')}
                >
                  <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </>
            )}
          </div>
        </Button>
      </div>

      <SidebarProjectSessions
        entry={entry}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={entry.checkouts.some((checkout) => Boolean(checkout.sessionMeta?.hasMore))}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        attentionSessionIds={attentionSessionIds}
        unreadSessionIds={unreadSessionIds}
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
        visibleSessionCount={visibleSessionCount}
        onShowAllSessions={onShowAllSessions}
        onCollapseSessions={onCollapseSessions}
        onNewSession={onNewSession}
        onNewSessionMenu={onNewSessionMenu}
        onNewWorktree={onNewWorktree}
        onLongPressSessionMenu={onLongPressSessionMenu}
        activeContextMenuKey={activeContextMenuKey}
        t={t}
      />
    </div>
  );
}
