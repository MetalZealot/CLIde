import { useMemo } from 'react';
import { MessageSquare } from 'lucide-react';

import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { getSessionDate, getSessionName } from '../../utils/utils';

import SidebarProjectsState from './SidebarProjectsState';
import SidebarSessionItem from './SidebarSessionItem';
import type { SidebarProjectListProps } from './SidebarProjectList';

type ConversationEntry = {
  project: Project;
  session: SessionWithProvider;
};

type SidebarAllConversationsProps = {
  projectListProps: SidebarProjectListProps;
  searchFilter: string;
};

/**
 * Flat list of every loaded session across all projects, sorted by last
 * activity. Rendered when the "Conversations" tab is active without a
 * full-text search query (2+ characters hands off to conversation search).
 */
export default function SidebarAllConversations({
  projectListProps,
  searchFilter,
}: SidebarAllConversationsProps) {
  const {
    projects,
    isLoading,
    loadingProgress,
    getProjectSessions,
    selectedSession,
    activeSessions,
    attentionSessionIds,
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
    onLongPressSessionMenu,
    t,
  } = projectListProps;

  const entries = useMemo<ConversationEntry[]>(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase();

    return projects
      .flatMap((project) =>
        getProjectSessions(project).map((session) => ({ project, session })),
      )
      .filter(({ project, session }) => {
        if (!normalizedSearch) {
          return true;
        }

        return (
          getSessionName(session, t).toLowerCase().includes(normalizedSearch) ||
          (project.displayName || project.projectId).toLowerCase().includes(normalizedSearch)
        );
      })
      .sort((a, b) => getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime());
  }, [getProjectSessions, projects, searchFilter, t]);

  if (isLoading || projects.length === 0) {
    return (
      <SidebarProjectsState
        isLoading={isLoading}
        loadingProgress={loadingProgress}
        projectsCount={projects.length}
        filteredProjectsCount={projects.length}
        t={t}
      />
    );
  }

  if (entries.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <MessageSquare className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
          {searchFilter.trim()
            ? t('conversations.noMatchingSessions', 'No matching conversations')
            : t('conversations.emptyTitle', 'No conversations yet')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {searchFilter.trim()
            ? t('conversations.tryDifferentSearch', 'Try a different search term.')
            : t('conversations.emptyDescription', 'Sessions from all your projects will appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      <div className="px-3 pb-1 pt-1 md:px-1">
        <p className="text-xs text-muted-foreground">
          {`${entries.length} ${t(
            entries.length === 1 ? 'conversations.countOne' : 'conversations.countOther',
            entries.length === 1 ? 'conversation' : 'conversations',
          )}`}
        </p>
      </div>
      {entries.map(({ project, session }) => (
        <SidebarSessionItem
          key={`${project.projectId}-${session.id}`}
          project={project}
          session={session}
          selectedSession={selectedSession}
          isProcessing={activeSessions.has(session.id)}
          needsAttention={attentionSessionIds.has(session.id)}
          currentTime={currentTime}
          editingSession={editingSession}
          editingSessionName={editingSessionName}
          projectLabel={project.displayName || project.projectId}
          onEditingSessionNameChange={onEditingSessionNameChange}
          onStartEditingSession={onStartEditingSession}
          onCancelEditingSession={onCancelEditingSession}
          onSaveEditingSession={onSaveEditingSession}
          onProjectSelect={onProjectSelect}
          onSessionSelect={onSessionSelect}
          onDeleteSession={onDeleteSession}
          onLongPressMenu={onLongPressSessionMenu}
          t={t}
        />
      ))}
    </div>
  );
}
