import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { CheckoutSession, RepositoryEntry, SessionWithProvider } from '../../types/types';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';

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
  onShowMoreSessions: (entry: RepositoryEntry, loadedCount: number) => void;
  onNewSession: (project: Project) => void;
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
  onShowMoreSessions,
  onNewSession,
  onLongPressSessionMenu,
  activeContextMenuKey,
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
  // A new session has to land in exactly one working tree; the lead checkout is
  // the only non-arbitrary choice. Long-pressing the row reaches the others.
  const newSessionTarget = entry.leadCheckout;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="px-3 pb-1 pt-1 md:hidden">
        <button
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => {
            onProjectSelect(newSessionTarget);
            onNewSession(newSessionTarget);
          }}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </button>
      </div>

      <Button
        variant="default"
        size="sm"
        className="hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
        onClick={() => onNewSession(newSessionTarget)}
      >
        <Plus className="h-3 w-3" />
        {t('sessions.newSession')}
      </Button>

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

          {canShowMore && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onShowMoreSessions(entry, sessions.length)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : t('sessions.showMore')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
