import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { api } from '../utils/api';
import type { ServerEvent } from '../contexts/WebSocketContext';
import type {
  AppTab,
  LLMProvider,
  LoadingProgress,
  Project,
  ProjectSession,
} from '../types/app';
import type {
  CreateWorktreeOptions,
  CreateWorktreeOutcome,
} from '../components/sidebar/types/types';

import type { SessionActivityMap } from './useSessionProtection';
import {
  createSidebarSessionSignals,
  reduceSidebarSessionSignals,
} from './sidebarSessionSignals';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  /** Subscription to the unified websocket event stream. */
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  activeSessions: SessionActivityMap;
};

/**
 * Shape of the per-session sidebar delta broadcast by the backend file
 * watcher (`kind: session_upserted`). It carries everything needed to upsert
 * one session row in place — no full project-list snapshot is ever pushed.
 */
type SessionUpsertedEvent = ServerEvent & {
  sessionId: string;
  providerSessionId?: string | null;
  provider: LLMProvider;
  session: ProjectSession;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
  } | null;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

type RegisterOptimisticSessionArgs = {
  sessionId: string;
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

/**
 * Shape of `GET /api/providers/sessions/:sessionId` — the authoritative
 * session → owning-project resolution used when a `/session/<id>` URL points
 * at a session that is not present in the paginated project payloads.
 */
type SessionDetailsApiPayload = {
  data?: {
    sessionId?: string;
    provider?: string;
    summary?: string;
    createdAt?: string | null;
    lastActivity?: string | null;
    project?: {
      projectId?: string;
      path?: string;
      fullPath?: string;
      displayName?: string;
      isStarred?: boolean;
    } | null;
  };
};

type ProjectSessionPage = Pick<Project, 'sessions' | 'sessionMeta'>;

const DEFAULT_PROVIDER: LLMProvider = 'claude';

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const readSelectedProvider = (): LLMProvider => {
  try {
    const storedProvider = localStorage.getItem('selected-provider');
    return storedProvider ? storedProvider as LLMProvider : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
};

const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : DEFAULT_PROVIDER;
};

const normalizeSessionProvider = (session: ProjectSession): ProjectSession => ({
  ...session,
  __provider: getSessionProvider(session),
});

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    return (
      nextProject.projectId !== prevProject.projectId ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      Boolean(nextProject.isStarred) !== Boolean(prevProject.isStarred) ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster)
    );
  });
};

const mergeTaskMasterCache = (nextProjects: Project[], previousProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return nextProjects;
  }

  // Keyed by `projectId` (the DB primary key) so caches stay correct across
  // renames and other mutations that might have changed the display name.
  const previousTaskMasterByProject = new Map(
    previousProjects
      .filter((project) => Boolean(project.taskmaster))
      .map((project) => [project.projectId, project.taskmaster]),
  );

  return nextProjects.map((project) => {
    const cachedTaskMasterInfo = previousTaskMasterByProject.get(project.projectId);
    if (!cachedTaskMasterInfo) {
      return project;
    }

    return {
      ...project,
      taskmaster: cachedTaskMasterInfo,
    };
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return project.sessions ?? [];
};

const countLoadedProjectSessions = (project: Project): number => getProjectSessions(project).length;

const mergeSessionProviderLists = (baseSessions: ProjectSession[], additionalSessions: ProjectSession[]): ProjectSession[] => {
  const merged = [...baseSessions];
  const seenSessionIds = new Set(baseSessions.map((session) => String(session.id)));

  for (const session of additionalSessions) {
    const sessionId = String(session.id);
    if (seenSessionIds.has(sessionId)) {
      continue;
    }

    merged.push(session);
    seenSessionIds.add(sessionId);
  }

  return merged;
};

const mergeExpandedSessionPages = (previousProjects: Project[], incomingProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return incomingProjects;
  }

  const previousByProjectId = new Map(previousProjects.map((project) => [project.projectId, project]));

  return incomingProjects.map((incomingProject) => {
    const previousProject = previousByProjectId.get(incomingProject.projectId);
    if (!previousProject) {
      return incomingProject;
    }

    const previousLoadedCount = countLoadedProjectSessions(previousProject);
    const incomingLoadedCount = countLoadedProjectSessions(incomingProject);
    if (previousLoadedCount <= incomingLoadedCount) {
      return incomingProject;
    }

    const mergedProject: Project = {
      ...incomingProject,
      sessions: mergeSessionProviderLists(incomingProject.sessions ?? [], previousProject.sessions ?? []),
    };

    const totalSessions = Number(incomingProject.sessionMeta?.total ?? previousLoadedCount);
    mergedProject.sessionMeta = {
      ...incomingProject.sessionMeta,
      total: totalSessions,
      hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
    };

    return mergedProject;
  });
};

const mergeProjectSessionPage = (
  existingProject: Project,
  sessionsPage: ProjectSessionPage,
): Project => {
  const mergedProject: Project = {
    ...existingProject,
    sessions: mergeSessionProviderLists(existingProject.sessions ?? [], sessionsPage.sessions ?? []),
  };

  const totalSessions = Number(sessionsPage.sessionMeta?.total ?? existingProject.sessionMeta?.total ?? 0);
  mergedProject.sessionMeta = {
    ...existingProject.sessionMeta,
    ...sessionsPage.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
  };

  return mergedProject;
};

const getSessionAliasIds = (event: SessionUpsertedEvent): Set<string> => {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  };

  add(event.sessionId);
  add(event.providerSessionId);
  add(event.session?.id);

  return ids;
};

/**
 * Upserts one session into a project's normalized session list.
 *
 * Existing rows are updated in place (summary/lastActivity changes from the
 * watcher); new rows are prepended since the watcher only fires for sessions
 * with fresh activity. `sessionMeta.total` grows only on insert.
 */
const upsertSessionIntoProject = (project: Project, event: SessionUpsertedEvent): Project => {
  const sessions = project.sessions ?? [];
  const aliasIds = getSessionAliasIds(event);
  const normalizedSession: ProjectSession = {
    ...event.session,
    id: event.sessionId,
    __provider: event.provider,
  };
  const existingIndex = sessions.findIndex((session) => aliasIds.has(String(session.id)));

  let nextSessions: ProjectSession[];
  let inserted = false;
  if (existingIndex >= 0) {
    let changed = false;
    nextSessions = [];

    for (const [index, session] of sessions.entries()) {
      if (index === existingIndex) {
        const updated = { ...session, ...normalizedSession };
        // Never let a later upsert that carries an empty summary blank out a
        // title we already have. Fresh sessions momentarily broadcast an empty
        // custom_name before the disk indexer fills it in, which would
        // otherwise flash the row back to the "New session" placeholder.
        if (!normalizedSession.summary?.trim() && session.summary?.trim()) {
          updated.summary = session.summary;
        }
        if (serialize(session) !== serialize(updated)) {
          changed = true;
        }
        nextSessions.push(updated);
        continue;
      }

      if (aliasIds.has(String(session.id))) {
        changed = true;
        continue;
      }

      nextSessions.push(session);
    }

    if (!changed) {
      return project;
    }
  } else {
    nextSessions = [normalizedSession, ...sessions];
    inserted = true;
  }

  const next: Project = { ...project, sessions: nextSessions };
  if (inserted) {
    const total = Number(project.sessionMeta?.total ?? 0) + 1;
    next.sessionMeta = {
      ...project.sessionMeta,
      total,
      hasMore: countLoadedProjectSessions(next) < total,
    };
  }

  return next;
};

const projectFromRegistration = (project: Project): Project => ({
  projectId: project.projectId,
  path: project.path || project.fullPath,
  fullPath: project.fullPath || project.path || '',
  displayName: project.displayName,
  isStarred: project.isStarred,
  sessions: project.sessions ?? [],
  sessionMeta: project.sessionMeta ?? { hasMore: false, total: countLoadedProjectSessions(project) },
  taskmaster: project.taskmaster,
});

const removeSessionFromProject = (project: Project, sessionIdToDelete: string): Project => {
  const sessions = project.sessions ?? [];
  const nextSessions = sessions.filter((session) => session.id !== sessionIdToDelete);
  if (nextSessions.length === sessions.length) {
    return project;
  }

  const updatedProject: Project = {
    ...project,
    sessions: nextSessions,
  };

  const totalSessions = Math.max(0, Number(project.sessionMeta?.total ?? 0) - 1);
  updatedProject.sessionMeta = {
    ...project.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(updatedProject) < totalSessions,
  };

  return updatedProject;
};

/**
 * Patches one session in place inside a project's list without touching order or
 * counts — for optimistic flag flips (starring) where the row is already loaded.
 * Returns the same project reference when the session is absent, so React skips
 * untouched projects.
 */
const patchSessionInProject = (
  project: Project,
  sessionId: string,
  patch: Partial<ProjectSession>,
): Project => {
  const sessions = project.sessions ?? [];
  const index = sessions.findIndex((session) => String(session.id) === sessionId);
  if (index < 0) {
    return project;
  }

  const nextSessions = sessions.slice();
  nextSessions[index] = { ...nextSessions[index], ...patch };
  return { ...project, sessions: nextSessions };
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'browser']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  subscribe,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  // Two independent per-session signals with different lifecycles: amber follows
  // an unresolved permission/question request, green is read-aware output and
  // clears when the session opens.
  const [{ attentionSessionIds, unreadSessionIds }, dispatchSessionSignal] = useReducer(
    reduceSidebarSessionSignals,
    undefined,
    createSidebarSessionSignals,
  );
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // undefined means "open at the Settings root list".
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  /**
   * `newSessionTrigger` is an explicit, monotonic intent signal for user-driven
   * New Session actions.
   *
   * It exists because `handleNewSession` can be invoked while the app is already in
   * the same visible state (`selectedSession === null`, `activeTab === 'chat'`,
   * route already `/`). In that case, React/router updates are idempotent and no
   * downstream reset logic runs.
   *
   * Usage across the codebase:
   * 1) Produced here in `handleNewSession` via increment (always changes).
   * 2) Returned from this hook and threaded through:
   *    useProjectsState -> AppContent -> MainContent -> ChatInterface.
   * 3) Consumed in `useChatSessionState` as an effect dependency to forcibly clear
   *    chat-local state (`currentSessionId`, pending draft message, streaming flags,
   *    pending session storage keys, pagination/scroll artifacts).
   *
   * Keeping this signal dedicated avoids coupling resets to unrelated counters/events
   * (for example websocket/project refresh updates) that could cause accidental resets.
   */
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Ref mirrors for state the websocket subscription handler needs.
   *
   * The subscription is registered once (per `subscribe` identity) and events
   * are dispatched synchronously outside React's render cycle, so the handler
   * must read the latest values through refs instead of stale closures —
   * re-subscribing on every state change would risk missing events.
   */
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /** URL session id whose backend lookup already ran (or is in flight) — one attempt per id. */
  const sessionLookupRef = useRef<string | null>(null);

  useEffect(() => {
    sessionLookupRef.current = null;
  }, [sessionId]);

  const markSessionAttention = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    dispatchSessionSignal({ type: 'request_attention', sessionId: targetSessionId });
  }, []);

  const markSessionUnread = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;
    if (targetSessionId === viewedSessionId) {
      return;
    }

    dispatchSessionSignal({ type: 'mark_unread', sessionId: targetSessionId });
  }, [sessionId]);

  const resolveSessionAttention = useCallback((
    targetSessionId?: string | null,
    markUnread = false,
  ) => {
    if (!targetSessionId) {
      return;
    }

    dispatchSessionSignal({
      type: 'resolve_attention',
      sessionId: targetSessionId,
      markUnread,
    });
  }, []);

  const markSessionViewed = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    dispatchSessionSignal({ type: 'view', sessionId: targetSessionId });
  }, []);

  const removeSessionSignals = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    dispatchSessionSignal({ type: 'remove', sessionId: targetSessionId });
  }, []);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}): Promise<Project[]> => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        const projectsWithTaskMaster = mergeTaskMasterCache(projectData, prevProjects);
        const mergedProjects = mergeExpandedSessionPages(prevProjects, projectsWithTaskMaster);

        if (prevProjects.length === 0) {
          return mergedProjects;
        }

        return projectsHaveChanges(prevProjects, mergedProjects)
          ? mergedProjects
          : prevProjects;
      });
      return projectData;
    } catch (error) {
      console.error('Error fetching projects:', error);
      return projectsRef.current;
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    return fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  /**
   * Creates and registers a linked worktree, then resolves the returned project
   * against the refreshed list so every caller gets the canonical
   * repository/branch metadata.
   */
  const createWorktree = useCallback(
    async (options: CreateWorktreeOptions): Promise<CreateWorktreeOutcome> => {
      const response = await api.createWorktree(options.projectId, {
        branch: options.branch,
        path: options.worktreePath ?? null,
        baseRef: options.baseRef ?? null,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string | { message?: string; details?: string };
        };
        const error = data.error;
        throw new Error(
          typeof error === 'string'
            ? error
            : error?.details || error?.message || 'Failed to create worktree',
        );
      }

      const payload = (await response.json().catch(() => ({}))) as {
        data?: {
          worktreePath?: string;
          project?: Project | null;
          registrationError?: string | null;
        };
      };
      const refreshedProjects = await refreshProjectsSilently();
      const returnedProject = payload.data?.project ?? null;
      const canonicalProject = returnedProject
        ? refreshedProjects.find((project) => project.projectId === returnedProject.projectId) ?? returnedProject
        : null;

      return {
        worktreePath: payload.data?.worktreePath ?? '',
        project: canonicalProject,
        registrationError: payload.data?.registrationError ?? null,
      };
    },
    [refreshProjectsSilently],
  );

  /**
   * Registers a checkout the projects API discovered on disk.
   *
   * Discovery is derived per request and writes nothing, so a discovered checkout
   * has a synthetic `projectId` and cannot be starred, renamed, or opened until
   * it has a row. This is the one call that gives it one — the same
   * `create-project` endpoint, pointed at a path the user never had to know.
   */
  const adoptCheckout = useCallback(
    async (checkoutPath: string): Promise<Project | null> => {
      const response = await api.createProject({ path: checkoutPath });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string | { message?: string; details?: string };
        };
        const error = data.error;
        throw new Error(
          typeof error === 'string'
            ? error
            : error?.details || error?.message || 'Failed to add worktree',
        );
      }

      const payload = (await response.json().catch(() => ({}))) as { project?: Project | null };
      const refreshedProjects = await refreshProjectsSilently();
      const returnedProject = payload.project ?? null;

      return returnedProject
        ? refreshedProjects.find((project) => project.projectId === returnedProject.projectId)
          ?? returnedProject
        : null;
    },
    [refreshProjectsSilently],
  );

  const registerOptimisticSession = useCallback(({
    sessionId: newSessionId,
    provider,
    project,
    summary,
  }: RegisterOptimisticSessionArgs) => {
    if (!newSessionId || !project?.projectId) {
      return;
    }

    const now = new Date().toISOString();
    const optimisticSession: ProjectSession = {
      id: newSessionId,
      summary: summary ?? '',
      messageCount: 0,
      createdAt: now,
      created_at: now,
      updated_at: now,
      lastActivity: now,
      __provider: provider,
      __projectId: project.projectId,
    };
    const upsert: SessionUpsertedEvent = {
      kind: 'session_upserted',
      sessionId: newSessionId,
      provider,
      session: optimisticSession,
      project: {
        projectId: project.projectId,
        path: project.path || project.fullPath,
        fullPath: project.fullPath || project.path || '',
        displayName: project.displayName,
        isStarred: Boolean(project.isStarred),
      },
      timestamp: now,
    };

    setProjects((previousProjects) => {
      const existingProject = previousProjects.find((candidate) => candidate.projectId === project.projectId);
      if (!existingProject) {
        return [upsertSessionIntoProject(projectFromRegistration(project), upsert), ...previousProjects];
      }

      const updatedProject = upsertSessionIntoProject(existingProject, upsert);
      if (updatedProject === existingProject) {
        return previousProjects;
      }

      return previousProjects.map((candidate) =>
        candidate.projectId === existingProject.projectId ? updatedProject : candidate,
      );
    });

    setSelectedProject((previousProject) => {
      if (!previousProject || previousProject.projectId !== project.projectId) {
        return previousProject;
      }

      const updatedProject = upsertSessionIntoProject(previousProject, upsert);
      return updatedProject === previousProject ? previousProject : updatedProject;
    });

    setSelectedSession((previousSession) => (
      previousSession?.id === newSessionId
        ? { ...previousSession, ...optimisticSession }
        : optimisticSession
    ));
  }, []);

  // Hydrates TaskMaster details for the given `projectId`. The project
  // identifier comes directly from the DB-driven /api/projects response.
  const hydrateProjectTaskMaster = useCallback(async (projectId: string) => {
    if (!projectId) {
      return;
    }

    try {
      const response = await api.projectTaskmaster(projectId);
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { taskmaster?: Project['taskmaster'] };
      const taskMasterInfo = data.taskmaster;
      if (!taskMasterInfo) {
        return;
      }

      setProjects((previousProjects) =>
        previousProjects.map((project) =>
          project.projectId === projectId
            ? { ...project, taskmaster: taskMasterInfo }
            : project,
        ),
      );

      setSelectedProject((previousProject) => {
        if (!previousProject || previousProject.projectId !== projectId) {
          return previousProject;
        }

        return {
          ...previousProject,
          taskmaster: taskMasterInfo,
        };
      });
    } catch (error) {
      console.error(`Error fetching TaskMaster info for project ${projectId}:`, error);
    }
  }, []);

  // No argument opens the root list, which is now a real destination rather
  // than "whichever tab happened to be first".
  const openSettings = useCallback((tab?: string) => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!selectedProject?.projectId) {
      return;
    }

    void hydrateProjectTaskMaster(selectedProject.projectId);
  }, [hydrateProjectTaskMaster, selectedProject?.projectId]);

  // Realtime sidebar updates. The backend pushes per-session deltas
  // (`session_upserted`) instead of full project snapshots, so each event is
  // a keyed upsert that can never clobber unrelated client state — no
  // "suppress updates while a run is active" protection is needed anymore.
  useEffect(() => {
    const handleEvent = (event: ServerEvent) => {
      if (event.kind === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }

        setLoadingProgress(event as unknown as LoadingProgress);

        if (event.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }

        return;
      }

      const eventSessionId = typeof event.sessionId === 'string' && event.sessionId
        ? event.sessionId
        : null;
      const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;

      if (eventSessionId) {
        if (event.kind === 'permission_request') {
          // Pending attention is request-aware rather than read-aware: keep it
          // even while its session is open, until the prompt resolves.
          markSessionAttention(eventSessionId);
        } else if (event.kind === 'permission_cancelled') {
          // Prompt withdrawn/answered: clear yellow. If it happened in the
          // background, retain a green unread signal for the resulting output.
          resolveSessionAttention(eventSessionId, eventSessionId !== viewedSessionId);
        } else if (
          eventSessionId !== viewedSessionId
          && event.kind !== 'chat_subscribed'
          && event.kind !== 'loading_progress'
          && event.kind !== 'session_upserted'
          && event.kind !== 'status'
          && event.kind !== 'stream_end'
          && event.kind !== 'websocket_reconnected'
        ) {
          // Any other unviewed-session output → green "unread".
          markSessionUnread(eventSessionId);
        }
      }

      // While the socket was down no `session_upserted` deltas arrived, so the
      // list is stale by an unknown amount. Resync once on reconnect — this is
      // what makes a manual refresh control unnecessary. Silent, so it cannot
      // disturb an open chat.
      if (event.kind === 'websocket_reconnected') {
        void refreshProjectsSilently();
        return;
      }

      if (event.kind !== 'session_upserted') {
        return;
      }

      const upsert = event as SessionUpsertedEvent;
      if (!upsert.sessionId || !upsert.session) {
        return;
      }

      // The transcript of the currently viewed session changed on disk while
      // no run is active here (e.g. edited from another client or the CLI):
      // signal the chat view to reload its messages.
      const currentSelectedSession = selectedSessionRef.current;
      if (
        currentSelectedSession
        && upsert.sessionId === currentSelectedSession.id
        && !activeSessionsRef.current.has(upsert.sessionId)
      ) {
        setExternalMessageUpdate((prev) => prev + 1);
      } else {
        markSessionUnread(upsert.sessionId);
      }

      setProjects((previousProjects) => {
        const targetProjectId = upsert.project?.projectId;
        const existingProject = previousProjects.find((project) =>
          targetProjectId ? project.projectId === targetProjectId : getProjectSessions(project).some((session) => session.id === upsert.sessionId),
        );

        if (!existingProject) {
          // First session of a project this client has never seen: create the
          // project entry from the event payload.
          if (!upsert.project) {
            return previousProjects;
          }

          const newProject: Project = {
            projectId: upsert.project.projectId,
            path: upsert.project.path,
            fullPath: upsert.project.fullPath,
            displayName: upsert.project.displayName,
            isStarred: upsert.project.isStarred,
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          } as Project;

          return [...previousProjects, upsertSessionIntoProject(newProject, upsert)];
        }

        const updatedProject = upsertSessionIntoProject(existingProject, upsert);
        if (updatedProject === existingProject) {
          return previousProjects;
        }

        return previousProjects.map((project) =>
          project.projectId === existingProject.projectId ? updatedProject : project,
        );
      });

      // Keep the selected project reference in sync with the upsert.
      setSelectedProject((previousProject) => {
        if (!previousProject) {
          return previousProject;
        }
        const matches = upsert.project
          ? previousProject.projectId === upsert.project.projectId
          : getProjectSessions(previousProject).some((session) => session.id === upsert.sessionId);
        if (!matches) {
          return previousProject;
        }
        const updated = upsertSessionIntoProject(previousProject, upsert);
        return updated === previousProject ? previousProject : updated;
      });

      const aliasedSelectedSessionId =
        typeof upsert.providerSessionId === 'string' && upsert.providerSessionId !== upsert.sessionId
          ? upsert.providerSessionId
          : null;
      if (!aliasedSelectedSessionId) {
        return;
      }

      const normalizedSelectedSession: ProjectSession = {
        ...upsert.session,
        id: upsert.sessionId,
        __provider: upsert.provider,
        __projectId: upsert.project?.projectId ?? currentSelectedSession?.__projectId,
      };

      setSelectedSession((previousSession) => {
        if (previousSession?.id !== aliasedSelectedSessionId) {
          return previousSession;
        }

        return {
          ...previousSession,
          ...normalizedSelectedSession,
        };
      });

      if (sessionId === aliasedSelectedSessionId) {
        navigate(`/session/${upsert.sessionId}`);
      }
    };

    return subscribe(handleEvent);
  }, [markSessionAttention, markSessionUnread, navigate, refreshProjectsSilently, resolveSessionAttention, sessionId, subscribe]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    markSessionViewed(selectedSession?.id ?? sessionId ?? null);
  }, [markSessionViewed, selectedSession?.id, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    // Project membership is resolved through `projectId` after the migration.
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === sessionId);
      if (match) {
        const normalizedSession = normalizeSessionProvider(match);
        const shouldUpdateProject = selectedProject?.projectId !== project.projectId;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== normalizedSession.__provider;

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession(normalizedSession);
        }
        return;
      }
    }

    if (selectedSession?.id === sessionId) {
      return;
    }

    // Session id is in the URL but not present on any loaded project payload.
    // The payloads are paginated (only each project's first session page is
    // loaded), so this is normal for deep links to older sessions. Never guess
    // the owning project from local state — that used to bind the session to
    // whatever project happened to be selected. Ask the backend instead; one
    // lookup per URL id.
    if (sessionLookupRef.current === sessionId) {
      return;
    }
    sessionLookupRef.current = sessionId;

    void (async () => {
      let details: SessionDetailsApiPayload['data'] | null = null;
      try {
        const response = await api.sessionDetails(sessionId);
        if (response.ok) {
          const payload = (await response.json()) as SessionDetailsApiPayload;
          details = payload.data ?? null;
        }
      } catch (error) {
        console.error(`Error resolving session ${sessionId}:`, error);
      }

      // The user navigated elsewhere while the lookup was in flight.
      if (sessionIdRef.current !== sessionId) {
        return;
      }

      if (!details) {
        // Unknown session id (or lookup failed). Fall back to the legacy
        // behavior: host a placeholder under the currently selected project so
        // chat state stays alive (without a `selectedSession`, chat clears
        // `currentSessionId` and stops reading the session store).
        const fallbackProject = selectedProjectRef.current;
        if (!fallbackProject || selectedSessionRef.current?.id === sessionId) {
          return;
        }

        setSelectedSession({
          id: sessionId,
          __provider: readSelectedProvider(),
          __projectId: fallbackProject.projectId,
          summary: '',
        });
        return;
      }

      // The URL carried a provider-native alias id: swap it for the canonical
      // app-facing id and let this effect re-run against the new URL.
      if (typeof details.sessionId === 'string' && details.sessionId && details.sessionId !== sessionId) {
        navigate(`/session/${details.sessionId}`, { replace: true });
        return;
      }

      const resolvedProjectId = details.project?.projectId;
      if (resolvedProjectId) {
        setSelectedProject((previousProject) => {
          if (previousProject?.projectId === resolvedProjectId) {
            return previousProject;
          }

          const loadedProject = projectsRef.current.find(
            (candidate) => candidate.projectId === resolvedProjectId,
          );
          if (loadedProject) {
            return loadedProject;
          }

          // Owning project is not in the active project list (e.g. archived):
          // synthesize a minimal entry so the chat view still gets its paths.
          return {
            projectId: resolvedProjectId,
            path: details.project?.path ?? details.project?.fullPath ?? '',
            fullPath: details.project?.fullPath ?? details.project?.path ?? '',
            displayName: details.project?.displayName ?? '',
            isStarred: Boolean(details.project?.isStarred),
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          };
        });
      }

      const resolvedSession: ProjectSession = {
        id: sessionId,
        summary: details.summary ?? '',
        createdAt: details.createdAt ?? undefined,
        lastActivity: details.lastActivity ?? undefined,
        __provider:
          typeof details.provider === 'string' && details.provider.trim()
            ? (details.provider as LLMProvider)
            : readSelectedProvider(),
        __projectId: resolvedProjectId,
      };

      setSelectedSession((previousSession) =>
        previousSession?.id === sessionId
          ? { ...previousSession, ...resolvedSession }
          : resolvedSession,
      );
    })();
  }, [navigate, sessionId, projects, selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      markSessionViewed(session.id);
      setSelectedSession(session);

      if (activeTab === 'tasks' || activeTab === 'browser') {
        setActiveTab('chat');
      }

      if (isMobile) {
        // Sessions are tagged with the owning project's DB `projectId` when
        // picked from the sidebar (see useSidebarController); compare against
        // the current selection's `projectId` so we know whether to collapse
        // the sidebar after navigation.
        const sessionProjectId = session.__projectId;
        const currentProjectId = selectedProject?.projectId;

        if (sessionProjectId !== currentProjectId) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, markSessionViewed, navigate, selectedProject?.projectId],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setNewSessionTrigger((previous) => previous + 1);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleOpenNewSession = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('chat');
    setNewSessionTrigger((previous) => previous + 1);
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      removeSessionSignals(sessionIdToDelete);

      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => removeSessionFromProject(project, sessionIdToDelete)),
      );
    },
    [navigate, removeSessionSignals, selectedSession?.id],
  );

  // Optimistic in-place patch of a session's starred flag, called around the API
  // round-trip. Only the flag flips here — starred-first pinning is applied
  // downstream by `getAllSessions`, which re-sorts when `isStarred` changes.
  const handleSessionStarPatch = useCallback((sessionIdToPatch: string, isStarred: boolean) => {
    setProjects((prevProjects) =>
      prevProjects.map((project) => patchSessionInProject(project, sessionIdToPatch, { isStarred })),
    );
  }, []);

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];
      const projectsWithTaskMaster = mergeTaskMasterCache(freshProjects, projects);
      const mergedProjects = mergeExpandedSessionPages(projects, projectsWithTaskMaster);

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, mergedProjects) ? mergedProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = mergedProjects.find((project) => project.projectId === selectedProject.projectId);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [projects, selectedProject, selectedSession]);

  const loadMoreProjectSessions = useCallback(async (projectId: string) => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) {
      return;
    }

    const loadedCount = countLoadedProjectSessions(project);
    const totalCount = Number(project.sessionMeta?.total ?? 0);
    if (totalCount > 0 && loadedCount >= totalCount) {
      return;
    }

    const response = await api.projectSessions(projectId, {
      limit: 20,
      offset: loadedCount,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string | { message?: string } };
      const errorPayload = payload.error;
      const message =
        typeof errorPayload === 'string'
          ? errorPayload
          : errorPayload && typeof errorPayload === 'object' && errorPayload.message
            ? errorPayload.message
            : `Failed to load more sessions for project ${projectId}`;
      throw new Error(message);
    }

    const sessionsPage = (await response.json()) as ProjectSessionPage;

    let mergedProjectForSelection: Project | null = null;
    setProjects((previousProjects) =>
      previousProjects.map((candidate) => {
        if (candidate.projectId !== projectId) {
          return candidate;
        }

        const mergedProject = mergeProjectSessionPage(candidate, sessionsPage);
        mergedProjectForSelection = mergedProject;
        return mergedProject;
      }),
    );

    if (selectedProject?.projectId === projectId && mergedProjectForSelection) {
      setSelectedProject(mergedProjectForSelection);
    }
  }, [projects, selectedProject?.projectId]);

  // `projectId` is the DB identifier passed from the sidebar's delete flow
  // after the migration away from folder-derived project names.
  const handleProjectDelete = useCallback(
    (projectId: string) => {
      if (selectedProject?.projectId === projectId) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.projectId !== projectId));
    },
    [navigate, selectedProject?.projectId],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      activeSessions,
      attentionSessionIds,
      unreadSessionIds,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onOpenNewSession: handleOpenNewSession,
      onNewSession: handleNewSession,
      onCreateWorktree: createWorktree,
      onAdoptCheckout: adoptCheckout,
      onSessionDelete: handleSessionDelete,
      onSessionStarPatch: handleSessionStarPatch,
      onLoadMoreSessions: loadMoreProjectSessions,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: openSettings,
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      attentionSessionIds,
      unreadSessionIds,
      handleOpenNewSession,
      handleNewSession,
      createWorktree,
      adoptCheckout,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionStarPatch,
      loadMoreProjectSessions,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      activeSessions,
      openSettings,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    createWorktree,
    handleSessionDelete,
    loadMoreProjectSessions,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
