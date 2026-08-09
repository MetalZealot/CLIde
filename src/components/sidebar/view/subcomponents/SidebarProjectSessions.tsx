import { useRef } from 'react';
import { Plus, TreeDeciduous } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, anchorFromElement } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { CheckoutSession, RepositoryEntry, SessionWithProvider } from '../../types/types';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';
import { SESSION_PAGE_SIZE } from '../../hooks/useSidebarController';

import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  entry: RepositoryEntry;
  isExpanded: boolean;
  sessions: CheckoutSession[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  /** How many of `sessions` to render before the "show more" control. */
  visibleSessionCount: number;
  onShowAllSessions: (entry: RepositoryEntry) => void;
  onCollapseSessions: (entry: RepositoryEntry) => void;
  onNewSession: (project: Project) => void;
  /** Asks which worktree to start in; only reached when there is a choice. */
  onNewSessionMenu?: (entry: RepositoryEntry, anchor: ContextMenuAnchor) => void;
  /** Opens the worktree manager with its create form already open. */
  onNewWorktree?: (entry: RepositoryEntry) => void;
  onLongPressSessionMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  activeContextMenuKey?: string | null;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * The one list under a repository row: every session across its checkouts,
 * merged and ordered together (ADR 0016).
 *
 * Each row carries its *own* checkout, so selecting a session still switches
 * the app to the working tree that session actually runs in — the branch label
 * is only there to say which one that is.
 */
export default function SidebarProjectSessions({
  entry,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  attentionSessionIds,
  unreadSessionIds,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  visibleSessionCount,
  onShowAllSessions,
  onCollapseSessions,
  onNewSession,
  onNewSessionMenu,
  onNewWorktree,
  onLongPressSessionMenu,
  activeContextMenuKey,
  t,
}: SidebarProjectSessionsProps) {
  const mobileNewSessionRef = useRef<HTMLButtonElement>(null);
  const desktopNewSessionRef = useRef<HTMLButtonElement>(null);

  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  // A plain folder has no repository to add a worktree to, and the create form
  // would only fail server-side with "Not a git repository".
  const canAddWorktree = Boolean(entry.repositoryId) && Boolean(onNewWorktree);
  const visibleSessions = sessions.slice(0, visibleSessionCount);
  // More to show if this row is holding sessions back, or if the server still
  // has some it has not sent.
  const canShowMore = sessions.length > visibleSessions.length || hasMoreSessions;
  // How many are still hidden, when that is knowable. The server's own count is
  // per checkout and excludes pinned sessions, so a merged row can only promise
  // a number once every page has arrived; until then the label stays plain.
  const hiddenSessionCount = hasMoreSessions ? null : sessions.length - visibleSessions.length;
  // Nothing left to reveal and the cap has been lifted: the same button folds
  // the row back to its first page, so opening it is not a one-way door.
  const canShowLess = !canShowMore && visibleSessionCount > SESSION_PAGE_SIZE;

  /**
   * A new session has to land in exactly one worktree, so when the row covers
   * several the button asks which — picking for them would silently run the
   * session against the wrong branch. With one worktree there is no question to
   * put, so it starts straight away.
   */
  const startNewSession = (anchorElement: HTMLElement | null) => {
    if (entry.checkouts.length > 1 && onNewSessionMenu) {
      const rect = anchorElement?.getBoundingClientRect();
      onNewSessionMenu(entry, anchorFromElement(anchorElement, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }));
      return;
    }

    onProjectSelect(entry.leadCheckout);
    onNewSession(entry.leadCheckout);
  };

  // The rail marks the list as belonging to the row above it, and that is all
  // the indent it needs: each session already carries a provider logo, which
  // sets its text in from the left on its own.
  return (
    <div className="ml-2 space-y-1 border-l border-border pl-1">
      {/*
        Both actions share the width the single New Session button used to take.
        Filtering moved up into the row's header, so nothing here had to be
        condensed to make room; the two split the row evenly and the difference
        between them is weight, not size — starting a session is the ordinary
        act, adding a worktree the occasional one.
      */}
      <div className="flex gap-1 pb-1 pl-1 pr-3 pt-1 md:hidden">
        <button
          ref={mobileNewSessionRef}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => startNewSession(mobileNewSessionRef.current)}
        >
          <Plus className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{t('sessions.newSession')}</span>
        </button>
        {canAddWorktree && (
          <button
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium text-foreground transition-all duration-150 active:scale-[0.98] active:bg-accent/50"
            onClick={() => onNewWorktree?.(entry)}
          >
            <TreeDeciduous className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{t('worktrees.new')}</span>
          </button>
        )}
      </div>

      <div className="hidden gap-1 md:flex">
        <Button
          ref={desktopNewSessionRef}
          variant="default"
          size="sm"
          className="h-8 flex-1 justify-start gap-1.5 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={() => startNewSession(desktopNewSessionRef.current)}
        >
          <Plus className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{t('sessions.newSession')}</span>
        </Button>
        {canAddWorktree && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 justify-start gap-1.5 text-xs font-medium"
            onClick={() => onNewWorktree?.(entry)}
          >
            <TreeDeciduous className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{t('worktrees.new')}</span>
          </Button>
        )}
      </div>

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {visibleSessions.map(({ session, checkout, branchLabel }) => (
            <SidebarSessionItem
              key={session.id}
              project={checkout}
              session={session}
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
          ))}

          {/*
            One press opens the row completely rather than adding five at a
            time: paging a sidebar list in fives is busywork, and sorting or
            filtering needs the whole set loaded anyway.
          */}
          {(canShowMore || canShowLess) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => (canShowMore ? onShowAllSessions(entry) : onCollapseSessions(entry))}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions
                ? t('sessions.loadingSessions')
                : !canShowMore
                  ? t('sessions.showLess', 'Show less')
                  : hiddenSessionCount
                    ? t('sessions.showAllCount', {
                        count: hiddenSessionCount,
                        defaultValue: 'Show all ({{count}} more)',
                      })
                    : t('sessions.showAll', 'Show all sessions')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
