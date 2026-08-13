import type { TFunction } from 'i18next';

import { Button, type ContextMenuAnchor } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { CheckoutSession, RepositoryEntry, SessionWithProvider } from '../../types/types';
import { SESSION_PAGE_SIZE } from '../../hooks/useSidebarController';
import { projectAccentColorValue, type ProjectAccentColor } from '../../utils/accentColors';

import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  entry: RepositoryEntry;
  /** Lets the rail continue the repository row's highlight strip. */
  accentColor: ProjectAccentColor | null;
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
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  /** How many of `sessions` to render before the "show more" control. */
  visibleSessionCount: number;
  onShowAllSessions: (entry: RepositoryEntry) => void;
  onCollapseSessions: (entry: RepositoryEntry) => void;
  onOpenSessionActionsMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  activeContextMenuKey?: string | null;
  /** Ids ticked in batch mode; null when this row is not in batch mode. */
  batchSelectedIds: ReadonlySet<string> | null;
  onToggleBatchSelected: (sessionId: string) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="my-0.5 rounded-md py-2 pl-5 pr-3">
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
 * Each row carries its *own* checkout, so selecting a session switches the app to
 * the working tree it runs in; the branch label only says which.
 */
export default function SidebarProjectSessions({
  entry,
  accentColor,
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
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  visibleSessionCount,
  onShowAllSessions,
  onCollapseSessions,
  onOpenSessionActionsMenu,
  activeContextMenuKey,
  batchSelectedIds,
  onToggleBatchSelected,
  t,
}: SidebarProjectSessionsProps) {
  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  const visibleSessions = sessions.slice(0, visibleSessionCount);
  // More to show if this row is holding sessions back, or if the server still
  // has some it has not sent.
  const canShowMore = sessions.length > visibleSessions.length || hasMoreSessions;
  // How many are still hidden, when knowable. The server's count is per checkout
  // and excludes pinned sessions, so a merged row can only promise a number once
  // every page has arrived.
  const hiddenSessionCount = hasMoreSessions ? null : sessions.length - visibleSessions.length;
  // Nothing left to reveal and the cap lifted: the same button folds the row back
  // to its first page, so opening it is not one-way.
  const canShowLess = !canShowMore && visibleSessionCount > SESSION_PAGE_SIZE;

  // The rail starts at the same x as the repository row's accent strip (`w-1`
  // inside an `mx-3` row), so an open project and its sessions read as one spine.
  // It carries the project's colour for the same reason — that, not a background
  // tint, is what marks the row expanded.
  //
  // Narrower than the strip on purpose: at a matching 4px it read as a second UI
  // element competing with the rows. `pl-0.5` gives back the 2px, so the session
  // labels' text edge does not move.
  //
  // No `space-y`: rows own their spacing through `my-0.5`, and 4px on top made
  // this list twice as airy as the identical-looking Pinned list above.
  return (
    <div
      className="ml-3 border-l-2 border-border pl-0.5"
      style={accentColor ? { borderColor: projectAccentColorValue(accentColor) } : undefined}
    >
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="py-2 pl-5 pr-3 text-left">
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
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onProjectSelect={onProjectSelect}
              onSessionSelect={onSessionSelect}
              onOpenActionsMenu={onOpenSessionActionsMenu}
              activeContextMenuKey={activeContextMenuKey}
              isSelectionMode={batchSelectedIds !== null}
              isBatchSelected={batchSelectedIds?.has(session.id) ?? false}
              onToggleBatchSelected={onToggleBatchSelected}
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
              // pl-5 lands on the session labels' text edge (their ml-2 plus
              // px-3), so this reads as part of the list, not a control hanging
              // off it.
              className="my-0.5 h-7 w-full justify-start pl-5 pr-3 text-xs text-muted-foreground hover:text-foreground"
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
