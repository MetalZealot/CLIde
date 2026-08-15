import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, ChevronDown, ChevronRight, GitBranch, ListFilter, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  Button,
  anchorFromElement,
  RowActionsTrigger,
  type ContextMenuAnchor,
} from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type {
  CheckoutSession,
  RepositoryEntry,
  RepositoryViewOptions,
  SessionSelectionScope,
  SessionWithProvider,
} from '../../types/types';
import {
  getCheckoutRefLabel,
  isDefaultRepositoryView,
  resolveActivityState,
} from '../../utils/utils';
import { useLongPress } from '../../../../hooks/useLongPress';
import { projectAccentColorValue, readProjectAccentColor } from '../../utils/accentColors';

import SidebarProjectSessions from './SidebarProjectSessions';
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
  onEditingNameChange: (name: string) => void;
  onToggleProject: (entryKey: string) => void;
  onProjectSelect: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  visibleSessionCount: number;
  onShowAllSessions: (entry: RepositoryEntry) => void;
  onCollapseSessions: (entry: RepositoryEntry) => void;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  /** How this row is currently sorted and filtered. */
  viewOptions: RepositoryViewOptions;
  onOpenViewMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  onEditingSessionNameChange: (value: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  /**
   * Opens this repository row's action menu, anchored to the row (long-press),
   * to its kebab, or to the cursor (right-click). One menu, several ways in.
   */
  onOpenProjectActionsMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  /**
   * Repository scope keeps Projects-view batch selection inside this row.
   */
  onOpenSessionActionsMenu?: (
    session: SessionWithProvider,
    anchor: ContextMenuAnchor,
    selectionScope: SessionSelectionScope,
  ) => void;
  activeContextMenuKey?: string | null;
  /** Ids ticked in batch mode; null when this row is not in batch mode. */
  batchSelectedIds: ReadonlySet<string> | null;
  onToggleBatchSelected: (sessionId: string) => void;
  t: TFunction;
};

/**
 * Total across every checkout the row covers, so the count matches the list it
 * opens. `sessionMeta.total` is the server's count, including sessions not yet
 * paginated in.
 */
const getSessionCountDisplay = (
  entry: RepositoryEntry,
  sessions: CheckoutSession[],
  hasCustomView: boolean,
): number => {
  // A sorted or filtered row has loaded everything it holds and its list is the
  // filtered one; the server's total describes the unfiltered set.
  if (hasCustomView) {
    return sessions.length;
  }

  const hasServerTotals = entry.checkouts.some(
    (checkout) => typeof checkout.sessionMeta?.total === 'number',
  );

  if (!hasServerTotals) {
    return sessions.length;
  }

  return entry.checkouts.reduce(
    (total, checkout) => total + Number(checkout.sessionMeta?.total ?? 0),
    0,
  );
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
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onCancelEditingProject,
  onSaveProjectName,
  onSessionSelect,
  visibleSessionCount,
  onShowAllSessions,
  onCollapseSessions,
  activeSessions,
  unreadSessionIds,
  attentionSessionIds,
  viewOptions,
  onOpenViewMenu,
  onEditingSessionNameChange,
  onCancelEditingSession,
  onSaveEditingSession,
  onOpenProjectActionsMenu,
  onOpenSessionActionsMenu,
  activeContextMenuKey,
  batchSelectedIds,
  onToggleBatchSelected,
  t,
}: SidebarRepositoryItemProps) {
  // Rename and task status act on the lead checkout. Delete covers the whole
  // repository — the row is the repository, and deleting only the lead would
  // strand its other worktrees.
  const project = entry.leadCheckout;
  const isMerged = entry.checkouts.length > 1;
  // Any checkout being current lights the row, since they share it.
  const isSelected = entry.checkouts.some(
    (checkout) => selectedProject?.projectId === checkout.projectId,
  );
  const isEditing = editingProject === project.projectId;
  // The highlight belongs to the lead checkout, the same target rename and
  // Customize act on, so a merged row shows one colour. Unknown tokens resolve
  // to null and draw no strip.
  const accentColor = readProjectAccentColor(project.accentColor);
  // Drives the header control's lit state, so a row you filtered and navigated
  // away from still says so on return.
  const hasCustomView = !isDefaultRepositoryView(viewOptions);
  const totalSessionCount = getSessionCountDisplay(entry, sessions, hasCustomView);
  const sessionCountLabel = `${totalSessionCount} session${totalSessionCount === 1 ? '' : 's'}`;
  // A merged row names its checkouts, not a branch: each session below already
  // carries the one it belongs to.
  const rowSubtitle = isMerged
    ? t('projects.repositoryCheckouts', {
        count: entry.checkouts.length,
        defaultValue_one: '{{count}} worktree',
        defaultValue: '{{count}} worktrees',
      })
    : getCheckoutRefLabel(project);
  // Same symbol and precedence as individual rows. Use the repository's loaded
  // sessions rather than its filtered view so a hidden active row still rolls up.
  const repositorySessionIds = entry.checkouts.flatMap(
    (checkout) => (checkout.sessions ?? []).map((session) => session.id),
  );
  const projectActivityState = resolveActivityState({
    isProcessing: repositorySessionIds.some((sessionId) => activeSessions.has(sessionId)),
    needsAttention: repositorySessionIds.some((sessionId) => attentionSessionIds.has(sessionId)),
    isUnread: repositorySessionIds.some((sessionId) => unreadSessionIds.has(sessionId)),
  });

  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const viewCueRef = useRef<HTMLSpanElement>(null);

  const openViewMenu = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    onOpenViewMenu?.(
      entry,
      anchorFromElement(element, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }),
    );
  };

  /**
   * Sort and filter live in the row's own actions menu; the list itself carries
   * no permanent control for them. What the row does owe the user is why its
   * list is short, so a non-default view says so here — and only here, since in
   * the default state there is nothing to say.
   *
   * `role="button"` rather than a real one: on desktop this sits inside the
   * header's own <button>.
   */
  const viewCue = hasCustomView && onOpenViewMenu && (
    <span
      ref={viewCueRef}
      role="button"
      tabIndex={0}
      title={t('sessionView.title', 'Sort and filter sessions')}
      aria-label={t('sessionView.title', 'Sort and filter sessions')}
      className="flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-primary transition-colors hover:bg-primary/10"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openViewMenu(viewCueRef.current);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openViewMenu(viewCueRef.current);
      }}
    >
      <ListFilter className="h-3 w-3" />
      {t('sessionView.filtered', 'Filtered')}
    </span>
  );

  // ADR 0016: a branch and a checkout never share an icon. An unmerged row's
  // subtitle is a branch and keeps the branch glyph; a worktree count is just a
  // count, so it takes a separator.
  const rowSubtitleLead = isMerged ? (
    <span aria-hidden className="flex-shrink-0">·</span>
  ) : (
    <GitBranch className="h-3 w-3 flex-shrink-0 opacity-60" />
  );

  const viewCueWithSeparator = viewCue && (
    <>
      <span aria-hidden className="flex-shrink-0">·</span>
      {viewCue}
    </>
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
  // Anchor to the row's box, not the finger, so the menu opens attached to the
  // repository it acts on.
  const mobileRowRef = useRef<HTMLDivElement>(null);
  const { handlers: longPress, isPressing } = useLongPress(
    (coords) => onOpenProjectActionsMenu?.(entry, anchorFromElement(mobileRowRef.current, coords)),
    { disabled: !onOpenProjectActionsMenu },
  );
  const isMenuOpen = activeContextMenuKey === `project:${entry.key}`;
  // Stays on for as long as this row's menu is open.
  const isContextActive = isPressing || isMenuOpen;

  // Right-click anchors to the cursor. Free here, unlike the session row below:
  // that one is a real <a href>, where overriding the context menu would cost
  // the native "Open in new tab".
  const openProjectMenuAtCursor = (event: ReactMouseEvent<HTMLElement>) => {
    if (!onOpenProjectActionsMenu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenProjectActionsMenu(entry, {
      top: event.clientY,
      bottom: event.clientY,
      left: event.clientX,
    });
  };

  const saveProjectName = () => {
    onSaveProjectName(project.projectId);
  };

  /**
   * The customization highlight: a strip down the row's leading edge.
   *
   * Clipped by the row's `overflow-hidden`, so it inherits that row's corner
   * radius rather than hardcoding one per breakpoint. Deliberately outside the
   * sticky wrapper — that also holds the session controls, and this strip marks
   * the project, not its session list.
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
              // No resting card — see SidebarSessionItem. Opaque background only
              // while stuck to the top, so scrolled content cannot show through.
              // px-3 not p-2: the leading edge carries the accent strip and 8px
              // left the label almost touching it. Applied unconditionally, so
              // adding a colour never shifts the text.
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
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <h3 className="truncate text-sm font-medium text-foreground">{entry.displayName}</h3>
                      </div>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="flex-shrink-0">{sessionCountLabel}</span>
                        {rowSubtitle && (
                          <>
                            {rowSubtitleLead}
                            <span className="truncate" title={rowSubtitle}>
                              {rowSubtitle}
                            </span>
                          </>
                        )}
                        {viewCueWithSeparator}
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
          onContextMenu={openProjectMenuAtCursor}
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
                      // The branch (or checkout count) identifies the row better
                      // than a filesystem path.
                      <>
                        {rowSubtitleLead}
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
                    {viewCueWithSeparator}
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
                  `as="div"`: the desktop header is itself a <button>, so a
                  nested one would be invalid markup — the same reason the
                  rename and delete controls this replaces were divs.
                */}
                {onOpenProjectActionsMenu && (
                  <RowActionsTrigger
                    as="div"
                    label={t('actions.rowActions', 'Actions for {{name}}', { name: entry.displayName })}
                    isOpen={isMenuOpen}
                    onOpen={(anchor) => onOpenProjectActionsMenu(entry, anchor)}
                  />
                )}
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
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        visibleSessionCount={visibleSessionCount}
        onShowAllSessions={onShowAllSessions}
        onCollapseSessions={onCollapseSessions}
        onOpenSessionActionsMenu={
          onOpenSessionActionsMenu &&
          ((session, anchor) => onOpenSessionActionsMenu(session, anchor, {
            kind: 'repository',
            entryKey: entry.key,
          }))
        }
        activeContextMenuKey={activeContextMenuKey}
        batchSelectedIds={batchSelectedIds}
        onToggleBatchSelected={onToggleBatchSelected}
        t={t}
      />
    </div>
  );
}
