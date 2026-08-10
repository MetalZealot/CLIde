import { useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, Edit3, GitBranch, ListFilter, MessageSquare, Plus, TreeDeciduous, Trash2, X } from 'lucide-react';
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
import {
  getCheckoutRefLabel,
  getTaskIndicatorStatus,
  isDefaultRepositoryView,
  resolveActivityState,
} from '../../utils/utils';
import { useLongPress } from '../../../../hooks/useLongPress';
import { projectAccentColorValue, readProjectAccentColor } from '../../utils/accentColors';

import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';
import SidebarSectionHeader from './SidebarSectionHeader';
import SidebarStatusIndicator from './SidebarStatusIndicator';

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
  onOpenCreateMenu: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
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
  onOpenCreateMenu,
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
  // The highlight belongs to the lead checkout, the same target rename and the
  // Customize menu act on, so a merged row shows one colour rather than one per
  // worktree. Unknown tokens resolve to null and simply draw no strip.
  const accentColor = readProjectAccentColor(project.accentColor);
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
  // Roll up the same symbol and precedence as individual rows. Sessions not yet
  // paginated in cannot be mapped here; they appear once loaded.
  const projectActivityState = resolveActivityState({
    isProcessing: sessions.some(({ session }) => activeSessions.has(session.id)),
    needsAttention: sessions.some(({ session }) => attentionSessionIds.has(session.id)),
    isUnread: sessions.some(({ session }) => unreadSessionIds.has(session.id)),
  });

  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const viewMenuRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLButtonElement>(null);

  /**
   * Session-scoped controls live together in the Sessions subheader. That
   * subheader shares the project's sticky wrapper, so the controls stay tied to
   * the repository they act on while its session list scrolls underneath.
   */
  const openViewMenu = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    onOpenViewMenu?.(
      entry,
      anchorFromElement(element, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }),
    );
  };

  const openCreateMenu = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    onOpenCreateMenu(
      entry,
      anchorFromElement(element, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }),
    );
  };

  const viewMenuClasses = cn(
    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-all duration-200',
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

  /**
   * The customization highlight: a strip down the row's leading edge.
   *
   * Clipped by the row's own `overflow-hidden`, so it picks up whatever corner
   * radius that row has instead of hardcoding one per breakpoint. Kept out of
   * the sticky wrapper deliberately — that wrapper also holds the Sessions
   * subheader, and the strip marks the project, not its session list.
   */
  const accentStrip = accentColor && (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 w-1"
      style={{ backgroundColor: projectAccentColorValue(accentColor) }}
    />
  );

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
              // px-3 rather than p-2: the leading edge carries the accent strip,
              // and 8px left the label almost touching it. Applied whether or
              // not a colour is set, so adding one never shifts the text.
              'long-pressable relative overflow-hidden mx-3 my-0.5 rounded-lg px-3 py-2 transition-all duration-150',
              isContextActive && 'scale-[0.98] bg-accent/60',
              isSelected ? 'bg-primary/15' : 'active:bg-accent/50',
            )}
            onClick={toggleProject}
            {...longPress}
          >
            {accentStrip}
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
                          <h3 className="truncate text-sm font-medium text-foreground">{entry.displayName}</h3>
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
                    {projectActivityState && (
                      <SidebarStatusIndicator status={projectActivityState} t={t} />
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
            'hidden md:flex relative overflow-hidden w-full justify-between px-3 py-2 h-auto font-normal hover:bg-accent/50',
            isSelected && 'bg-primary/15',
          )}
          onClick={selectAndToggleProject}
        >
          {accentStrip}
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
                  <div className="truncate text-sm font-medium text-foreground" title={entry.displayName}>
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
                {projectActivityState && (
                  <SidebarStatusIndicator
                    status={projectActivityState}
                    t={t}
                    className="transition-opacity duration-200 group-hover:opacity-0"
                  />
                )}
                {/*
                  A div, not a button: the desktop header is itself a <button>,
                  so a nested one would be invalid markup. Same shape the rename
                  and delete controls beside it already use.
                */}
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

        {isExpanded && !isEditing && (
          <SidebarSectionHeader
            label={t('sessions.title')}
            icon={MessageSquare}
            summary={(
              // -my-1 keeps these 24px controls from growing the section
              // header's 16px box; the touch target stays 24px, the layout
              // height matches Pinned and Projects.
              <span className="-my-1 ml-auto flex items-center gap-1 normal-case tracking-normal">
                {onOpenViewMenu && (
                  <button
                    ref={viewMenuRef}
                    type="button"
                    className={viewMenuClasses}
                    onClick={() => openViewMenu(viewMenuRef.current)}
                    title={t('sessionView.title', 'Sort and filter sessions')}
                    aria-label={t('sessionView.title', 'Sort and filter sessions')}
                  >
                    <ListFilter className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  ref={createMenuRef}
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
                  onClick={() => openCreateMenu(createMenuRef.current)}
                  title={t('projects.createMenu', 'Create in project')}
                  aria-label={t('projects.createMenu', 'Create in project')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          />
        )}
      </div>

      <SidebarProjectSessions
        entry={entry}
        accentColor={accentColor}
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
        onLongPressSessionMenu={onLongPressSessionMenu}
        activeContextMenuKey={activeContextMenuKey}
        t={t}
      />
    </div>
  );
}
