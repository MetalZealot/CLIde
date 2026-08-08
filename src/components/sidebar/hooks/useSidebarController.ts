import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import { api } from '../../../utils/api';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type {
  ActivitySummary,
  ArchivedProjectListItem,
  ArchivedSessionListItem,
  CreateWorktreeOptions,
  CreateWorktreeOutcome,
  DeleteProjectConfirmation,
  ProjectSortOrder,
  RepositoryEntry,
  RepositoryViewOptions,
  SidebarSearchMode,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  applyRepositoryViewOptions,
  buildRepositoryEntries,
  collectActivitySessions,
  collectPinnedSessions,
  DEFAULT_REPOSITORY_VIEW_OPTIONS,
  filterProjectsBySessionTitle,
  getAllSessions,
  getUnpinnedCheckoutSessions,
  isDefaultRepositoryView,
  readProjectSortOrder,
  repositoryEntryKey,
  sortProjects,
} from '../utils/utils';

type SnippetHighlight = {
  start: number;
  end: number;
};

type ConversationMatch = {
  role: string;
  snippet: string;
  highlights: SnippetHighlight[];
  timestamp: string | null;
  provider?: string;
  messageUuid?: string | null;
};

type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  provider?: string;
  matches: ConversationMatch[];
};

type ConversationProjectResult = {
  // Emitted by the provider search service so the sidebar can map a
  // match back to the Project in its current state by projectId.
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

export type ConversationSearchResults = {
  results: ConversationProjectResult[];
  totalMatches: number;
  query: string;
};

export type SearchProgress = {
  scannedProjects: number;
  totalProjects: number;
};

type ArchivedSessionsApiPayload = {
  success?: boolean;
  data?: {
    sessions?: ArchivedSessionListItem[];
  };
};

type ArchivedProjectsApiPayload = {
  success?: boolean;
  data?: {
    projects?: ArchivedProjectListItem[];
  };
};

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  // Optimistic in-place patch of a session's starred flag (see useProjectsState).
  onSessionStarPatch?: (sessionId: string, isStarred: boolean) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB-assigned identifier; callbacks use that post-migration.
  onProjectDelete?: (projectId: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

/** Sessions a row shows before "Show all", and what "Show less" returns it to. */
export const SESSION_PAGE_SIZE = 5;

const ACTIVITY_SECTION_COLLAPSED_STORAGE_KEY = 'sidebar-activity-section-collapsed';

const readActivitySectionCollapsed = (): boolean => {
  try {
    return localStorage.getItem(ACTIVITY_SECTION_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession: _selectedSession,
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
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  const paletteOps = usePaletteOps();
  // Keyed by `repositoryEntryKey`, not by projectId: one repository is one row,
  // so its several checkouts share a single expansion state.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  // How many sessions each open row shows, keyed by `repositoryEntryKey`.
  // Absent means the default first page.
  const [visibleSessionCounts, setVisibleSessionCounts] = useState<Map<string, number>>(new Map());
  // Per-row sort/filter, keyed by entry key. Deliberately not persisted: it
  // clears on refresh (decided 2026-08-06).
  const [repositoryViews, setRepositoryViews] = useState<Map<string, RepositoryViewOptions>>(new Map());
  // Rows the user asked to see in full, which keep pulling pages until drained.
  const [fullyRevealedRows, setFullyRevealedRows] = useState<Set<string>>(new Set());
  const [isActivitySectionCollapsed, setIsActivitySectionCollapsed] = useState(
    readActivitySectionCollapsed,
  );
  const [isPinnedSectionCollapsed, setIsPinnedSectionCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [searchMode, setSearchMode] = useState<SidebarSearchMode>('projects');
  const [conversationResults, setConversationResults] = useState<ConversationSearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProjectListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionListItem[]>([]);
  const [isArchivedSessionsLoading, setIsArchivedSessionsLoading] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [loadingMoreProjects, setLoadingMoreProjects] = useState<Set<string>>(new Set());
  const searchSeqRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onRefreshRef = useRef(onRefresh);

  const isSidebarCollapsed = !isMobile && !sidebarVisible;
  const activeSessionIds = useMemo(() => new Set(activeSessions.keys()), [activeSessions]);

  const clearSearchFilter = useCallback(() => {
    setSearchFilter('');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setInitialSessionsLoaded(new Set());
  }, [projects]);

  // Expand the *row* holding the selected project, which for a worktree is its
  // repository's row rather than its own projectId.
  const selectedEntryKey = selectedProject ? repositoryEntryKey(selectedProject) : null;

  useEffect(() => {
    // Auto-expand only when the selected row changes.
    // Depending on the full `selectedProject` object (or `selectedSession`) causes
    // websocket-driven list refreshes to re-open projects users manually collapsed.
    if (!selectedEntryKey) {
      return;
    }

    setExpandedProjects((prev) => {
      if (prev.has(selectedEntryKey)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(selectedEntryKey);
      return next;
    });
  }, [selectedEntryKey]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.projectId);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const fetchArchivedSessions = useCallback(async () => {
    setIsArchivedSessionsLoading(true);

    try {
      const [archivedProjectsResponse, archivedSessionsResponse] = await Promise.all([
        api.archivedProjects(),
        api.getArchivedSessions(),
      ]);

      if (!archivedProjectsResponse.ok) {
        throw new Error(`Failed to load archived projects: ${archivedProjectsResponse.status}`);
      }

      if (!archivedSessionsResponse.ok) {
        throw new Error(`Failed to load archived sessions: ${archivedSessionsResponse.status}`);
      }

      const archivedProjectsPayload = (await archivedProjectsResponse.json()) as ArchivedProjectsApiPayload;
      const archivedSessionsPayload = (await archivedSessionsResponse.json()) as ArchivedSessionsApiPayload;
      const nextProjects = Array.isArray(archivedProjectsPayload.data?.projects) ? archivedProjectsPayload.data.projects : [];
      const archivedProjectIds = new Set(nextProjects.map((project) => project.projectId));
      const nextStandaloneSessions = Array.isArray(archivedSessionsPayload.data?.sessions)
        ? archivedSessionsPayload.data.sessions.filter((session) => !session.projectId || !archivedProjectIds.has(session.projectId))
        : [];

      setArchivedProjects(nextProjects);
      setArchivedSessions(nextStandaloneSessions);
    } catch (error) {
      console.error('[Sidebar] Failed to load archived sessions:', error);
    } finally {
      setIsArchivedSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchArchivedSessions();
  }, [fetchArchivedSessions]);

  useEffect(() => {
    if (searchMode !== 'archived') {
      return;
    }

    // Refresh archive contents when the archived tab opens so restore actions
    // and background synchronizer updates are reflected without a full reload.
    void fetchArchivedSessions();
  }, [fetchArchivedSessions, searchMode]);

  // Debounce search text updates so both project filtering and conversation
  // SSE requests avoid running on every keypress.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchFilter.trim());
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchFilter]);

  // Debounced conversation search with SSE streaming
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const query = debouncedSearchQuery;
    if (searchMode !== 'conversations' || query.length < 2) {
      searchSeqRef.current += 1;
      setConversationResults(null);
      setSearchProgress(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const seq = ++searchSeqRef.current;

    if (seq !== searchSeqRef.current) {
      return;
    }

    const url = api.searchConversationsUrl(query);
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const accumulated: ConversationProjectResult[] = [];
    let totalMatches = 0;

    es.addEventListener('result', (evt) => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      try {
        const data = JSON.parse(evt.data) as {
          projectResult: ConversationProjectResult;
          totalMatches: number;
          scannedProjects: number;
          totalProjects: number;
        };
        accumulated.push(data.projectResult);
        totalMatches = data.totalMatches;
        setConversationResults({ results: [...accumulated], totalMatches, query });
        setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
      } catch {
        // Ignore malformed SSE data
      }
    });

    es.addEventListener('progress', (evt) => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      try {
        const data = JSON.parse(evt.data) as { totalMatches: number; scannedProjects: number; totalProjects: number };
        totalMatches = data.totalMatches;
        setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
      } catch {
        // Ignore malformed SSE data
      }
    });

    es.addEventListener('done', () => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      es.close();
      eventSourceRef.current = null;
      setIsSearching(false);
      setSearchProgress(null);
      if (accumulated.length === 0) {
        setConversationResults({ results: [], totalMatches: 0, query });
      }
    });

    es.addEventListener('error', () => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      es.close();
      eventSourceRef.current = null;
      setIsSearching(false);
      setSearchProgress(null);
      if (accumulated.length === 0) {
        setConversationResults({ results: [], totalMatches: 0, query });
      }
    });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [debouncedSearchQuery, searchMode]);

  // Starred/loading state still keys on the DB `projectId`; expansion keys on
  // the row (`repositoryEntryKey`), since a repository is a single row.
  const toggleProject = useCallback((entryKey: string) => {
    setExpandedProjects((prev) => {
      const next = new Set<string>();
      if (!prev.has(entryKey)) {
        next.add(entryKey);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectId: string) => {
      // Tag the session with its owning projectId so downstream handlers
      // can correlate it with the selectedProject in the app state.
      onSessionSelect({ ...session, __projectId: projectId });
      clearSearchFilter();
    },
    [onSessionSelect, clearSearchFilter],
  );

  const getProjectSessions = useCallback((project: Project) => getAllSessions(project), []);

  const getRepositoryView = useCallback(
    (entryKey: string): RepositoryViewOptions =>
      repositoryViews.get(entryKey) ?? DEFAULT_REPOSITORY_VIEW_OPTIONS,
    [repositoryViews],
  );

  /** Drops the entry entirely at default, so "is this row customized?" stays a map lookup. */
  const setRepositoryView = useCallback((entryKey: string, options: RepositoryViewOptions) => {
    setRepositoryViews((previous) => {
      const next = new Map(previous);
      if (isDefaultRepositoryView(options)) {
        next.delete(entryKey);
      } else {
        next.set(entryKey, options);
      }
      return next;
    });
  }, []);

  const resetRepositoryView = useCallback((entryKey: string) => {
    setRepositoryViews((previous) => {
      if (!previous.has(entryKey)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(entryKey);
      return next;
    });
  }, []);

  const getRepositorySessions = useCallback(
    (entry: RepositoryEntry) =>
      applyRepositoryViewOptions(
        getUnpinnedCheckoutSessions(entry),
        getRepositoryView(entry.key),
        t,
      ),
    [getRepositoryView, t],
  );

  const togglePinnedSection = useCallback(() => {
    setIsPinnedSectionCollapsed((previous) => !previous);
  }, []);

  const toggleActivitySection = useCallback(() => {
    setIsActivitySectionCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(ACTIVITY_SECTION_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // The section still collapses when storage is unavailable.
      }
      return next;
    });
  }, []);

  const loadMoreSessionsForProject = useCallback(async (projectId: string) => {
    if (!onLoadMoreSessions) {
      return;
    }

    let shouldLoad = false;
    setLoadingMoreProjects((previous) => {
      if (previous.has(projectId)) {
        return previous;
      }

      shouldLoad = true;
      const next = new Set(previous);
      next.add(projectId);
      return next;
    });

    if (!shouldLoad) {
      return;
    }

    try {
      await onLoadMoreSessions(projectId);
    } catch (error) {
      console.error('[Sidebar] Failed to load more sessions:', error);
      alert(t('messages.refreshError'));
    } finally {
      setLoadingMoreProjects((previous) => {
        const next = new Set(previous);
        next.delete(projectId);
        return next;
      });
    }
  }, [onLoadMoreSessions, t]);

  /**
   * Pagination is still per checkout on the server, so one "load more" on a
   * merged row fans out to every checkout that still has sessions to fetch.
   */
  const loadMoreSessionsForRepository = useCallback(
    async (entry: RepositoryEntry) => {
      const pending = entry.checkouts.filter((checkout) => Boolean(checkout.sessionMeta?.hasMore));
      await Promise.all(
        pending.map((checkout) => loadMoreSessionsForProject(checkout.projectId)),
      );
    },
    [loadMoreSessionsForProject],
  );

  const getVisibleSessionCount = useCallback(
    (entryKey: string) => visibleSessionCounts.get(entryKey) ?? SESSION_PAGE_SIZE,
    [visibleSessionCounts],
  );

  /**
   * Opens one row all the way: every session it has, fetched and shown.
   *
   * This replaced a "show more" that added five at a time. Paging a sidebar row
   * five sessions at a time is busywork — the cap exists so one busy repository
   * cannot push every other project off the screen, and once you have asked to
   * see past it you have already said that is not what you want. Sorting and
   * filtering need the whole set loaded anyway (see the effect below), so this
   * is the same fetch the view menu performs, reachable on its own.
   *
   * The page loop lives in that effect: marking the row here is what starts it,
   * and it stops when no checkout reports more.
   */
  const showAllSessions = useCallback(
    (entry: RepositoryEntry) => {
      setFullyRevealedRows((previous) => {
        const next = new Set(previous);
        next.add(entry.key);
        return next;
      });

      setVisibleSessionCounts((previous) => {
        const next = new Map(previous);
        next.set(entry.key, Number.MAX_SAFE_INTEGER);
        return next;
      });

      void loadMoreSessionsForRepository(entry);
    },
    [loadMoreSessionsForRepository],
  );

  /**
   * Puts one row back to its first page. Already-fetched sessions stay in
   * memory, so this only changes how many are drawn; dropping the row from
   * `fullyRevealedRows` is what stops the page loop asking for more.
   */
  const collapseSessions = useCallback((entry: RepositoryEntry) => {
    setFullyRevealedRows((previous) => {
      if (!previous.has(entry.key)) {
        return previous;
      }

      const next = new Set(previous);
      next.delete(entry.key);
      return next;
    });

    setVisibleSessionCounts((previous) => {
      const next = new Map(previous);
      next.delete(entry.key);
      return next;
    });
  }, []);

  const sortedProjects = useMemo(
    () => sortProjects(projects, projectSortOrder),
    [projectSortOrder, projects],
  );

  const filteredProjects = useMemo(
    () => filterProjectsBySessionTitle(sortedProjects, debouncedSearchQuery),
    [debouncedSearchQuery, sortedProjects],
  );

  /**
   * True while a typed query is narrowing the rows to matching sessions. The
   * rows have to open themselves for it: a match the user cannot see is the
   * same as no match at all.
   */
  const isSessionSearchActive =
    searchMode !== 'conversations' && searchMode !== 'archived' && debouncedSearchQuery.length > 0;

  // ADR 0016: collapsing to one row per repository is the last step, so
  // sorting and the search filter both keep operating on a flat project list.
  const allRepositoryEntries = useMemo(
    () => buildRepositoryEntries(filteredProjects),
    [filteredProjects],
  );

  /**
   * Pinned sessions, lifted out of their rows into one section at the top of
   * the sidebar and listed there only (decided 2026-08-05).
   */
  const pinnedSessions = useMemo(
    () => collectPinnedSessions(allRepositoryEntries),
    [allRepositoryEntries],
  );

  /**
   * Transient session activity, copied above Pinned without removing anything
   * from its repository row. The collector applies the urgency ordering.
   */
  const activitySessions = useMemo(
    () => collectActivitySessions(
      allRepositoryEntries,
      activeSessionIds,
      attentionSessionIds,
      unreadSessionIds,
    ),
    [activeSessionIds, allRepositoryEntries, attentionSessionIds, unreadSessionIds],
  );
  const activitySummary = useMemo<ActivitySummary>(
    () => activitySessions.reduce(
      (summary, session) => ({
        ...summary,
        [session.activityState]: summary[session.activityState] + 1,
      }),
      { blocked: 0, unread: 0, running: 0 },
    ),
    [activitySessions],
  );

  /**
   * The rows drawn below the pinned section.
   *
   * A search that a row matched only through a pinned session leaves that row
   * with nothing left to list, and the match is already visible above it, so
   * the empty row drops out rather than reading as a dead end.
   */
  const repositoryEntries = useMemo(() => {
    if (!isSessionSearchActive) {
      return allRepositoryEntries;
    }

    return allRepositoryEntries.filter(
      (entry) => getUnpinnedCheckoutSessions(entry).length > 0,
    );
  }, [allRepositoryEntries, isSessionSearchActive]);

  /**
   * A sorted or filtered row loads every session it has before it answers.
   *
   * The server pages sessions (`isStarred DESC`, then newest first), so sorting
   * or filtering only the loaded page would quietly answer from five sessions
   * out of forty — an alphabetical list missing most of the alphabet, or a
   * worktree filter reporting nothing while its matches sit behind "show more".
   * Each arriving page re-runs this, and it stops once no checkout has more.
   */
  useEffect(() => {
    if (repositoryViews.size === 0 && fullyRevealedRows.size === 0) {
      return;
    }

    for (const entry of allRepositoryEntries) {
      if (!repositoryViews.has(entry.key) && !fullyRevealedRows.has(entry.key)) {
        continue;
      }

      if (entry.checkouts.some((checkout) => Boolean(checkout.sessionMeta?.hasMore))) {
        void loadMoreSessionsForRepository(entry);
      }
    }
  }, [allRepositoryEntries, fullyRevealedRows, loadMoreSessionsForRepository, repositoryViews]);

  const filteredArchivedSessions = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return archivedSessions;
    }

    return archivedSessions.filter((session) => {
      const searchableFields = [
        session.sessionTitle,
        session.projectDisplayName,
        session.projectPath ?? '',
        session.provider,
      ];

      return searchableFields.some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [archivedSessions, debouncedSearchQuery]);

  const filteredArchivedProjects = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return archivedProjects;
    }

    return archivedProjects.filter((project) => {
      const projectMatches = [
        project.displayName,
        project.fullPath || '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch));

      if (projectMatches) {
        return true;
      }

      return getAllSessions(project).some((session) => {
        const sessionSummary =
          typeof session.summary === 'string' && session.summary.trim().length > 0
            ? session.summary
            : typeof session.name === 'string'
              ? session.name
              : '';

        return [
          sessionSummary,
          session.__provider,
        ].some((value) => value.toLowerCase().includes(normalizedSearch));
      });
    });
  }, [archivedProjects, debouncedSearchQuery]);

  const startEditing = useCallback((project: Project) => {
    // `editingProject` is keyed by projectId so it stays stable across
    // display-name mutations that happen while the input is open.
    setEditingProject(project.projectId);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    // `projectId` is the DB primary key; the rename API resolves the path
    // through the `projects` table before writing the new display name.
    async (projectId: string) => {
      try {
        const response = await api.renameProject(projectId, editingName);
        if (response.ok) {
          await paletteOps.refreshProjects();
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName, paletteOps],
  );

  const showDeleteSessionConfirmation = useCallback(
    // Kept with project/provider arguments for component wiring compatibility;
    // deletion now uses only `sessionId` via /api/providers/sessions/:sessionId.
    (
      projectId: string | null,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
      options: {
        isArchived?: boolean;
      } = {},
    ) => {
      setSessionDeleteConfirmation({
        projectId,
        sessionId,
        sessionTitle,
        provider,
        isArchived: Boolean(options.isArchived),
      });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async (hardDelete = false) => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { sessionId } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    try {
      const response = await api.deleteSession(sessionId, hardDelete);

      if (response.ok) {
        onSessionDelete?.(sessionId);
        await fetchArchivedSessions();
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [fetchArchivedSessions, onSessionDelete, sessionDeleteConfirmation, t]);

  // Archive without the confirmation modal — Archive is recoverable from the
  // Archive tab, so the long-press menu archives directly (mirrors
  // confirmDeleteSession's soft-delete path with hardDelete=false).
  const archiveSessionDirect = useCallback(async (sessionId: string) => {
    try {
      const response = await api.deleteSession(sessionId, false);

      if (response.ok) {
        onSessionDelete?.(sessionId);
        await fetchArchivedSessions();
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to archive session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error archiving session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [fetchArchivedSessions, onSessionDelete, t]);

  // Optimistic session-star toggle: flip the icon immediately (which also pins
  // the session to the top via `getAllSessions`' starred-first sort), then
  // reconcile with the server's returned flag; revert on failure. No sequence
  // guard needed — the pin order follows `isStarred` directly rather than a
  // separate ordering map, so there is nothing to race against.
  const toggleStarSession = useCallback(
    (sessionId: string, currentIsStarred: boolean) => {
      const optimisticIsStarred = !currentIsStarred;
      onSessionStarPatch?.(sessionId, optimisticIsStarred);

      const run = async () => {
        try {
          const response = await api.toggleSessionStar(sessionId);
          if (!response.ok) {
            throw new Error(`Star toggle failed with status ${response.status}`);
          }

          const payload = (await response.json()) as { data?: { isStarred?: boolean } };
          const serverIsStarred = payload.data?.isStarred;
          if (typeof serverIsStarred === 'boolean' && serverIsStarred !== optimisticIsStarred) {
            onSessionStarPatch?.(sessionId, serverIsStarred);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to toggle session star:', error);
          onSessionStarPatch?.(sessionId, currentIsStarred);
        }
      };

      void run();
    },
    [onSessionStarPatch],
  );

  /** Confirms removal of one worktree — the manager's per-row action. */
  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        projects: [project],
        displayName: project.displayName || project.projectId,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  /**
   * Confirms removal of a whole repository row, every worktree included.
   *
   * A row *is* the repository, so deleting it must not leave its other
   * worktrees behind as rows of their own — which is exactly what deleting only
   * the lead would do.
   */
  const requestRepositoryDelete = useCallback(
    (entry: RepositoryEntry) => {
      setDeleteConfirmation({
        projects: entry.checkouts,
        displayName: entry.displayName,
        sessionCount: entry.checkouts.reduce(
          (total, checkout) => total + getProjectSessions(checkout).length,
          0,
        ),
      });
    },
    [getProjectSessions],
  );

  /**
   * Archives or removes every project in `targets`. `deleteData` is the
   * destructive branch: it drops the DB row and the provider transcripts.
   * Neither branch touches the directory on disk.
   *
   * A repository row's delete covers every worktree in it, so this is a batch,
   * and ADR 0017's preflight-then-rollback shape does not transfer: a hard
   * delete has nothing to roll back to. What transfers is the point of that
   * ADR — never leave the user in a half-finished state they cannot see. So
   * every target is attempted and the report names each failure, rather than
   * stopping at the first one with a message that does not say which of the
   * worktrees it is even about, or which of the rest were tried.
   */
  const deleteProjects = useCallback(
    async (targets: Project[], deleteData: boolean) => {
      const projectIds = targets.map((target) => target.projectId);
      // Track in-flight deletes by projectId so the UI can disable actions
      // even if the project object is rebuilt while the request is flying.
      setDeletingProjects((prev) => new Set([...prev, ...projectIds]));

      const failures: Array<{ name: string; reason: string }> = [];
      let removed = 0;

      try {
        for (const target of targets) {
          const name = target.displayName || target.projectId;

          try {
            const response = await api.deleteProject(target.projectId, deleteData);

            if (!response.ok) {
              const data = (await response.json().catch(() => ({}))) as {
                error?: string | { message?: string };
              };
              const err = data.error;
              failures.push({
                name,
                reason:
                  typeof err === 'string'
                    ? err
                    : (err && typeof err === 'object' && err.message) || t('messages.deleteProjectFailed'),
              });
              continue;
            }

            removed += 1;
            onProjectDelete?.(target.projectId);
          } catch (error) {
            console.error('Error deleting project:', error);
            failures.push({
              name,
              reason: error instanceof Error ? error.message : t('messages.deleteProjectError'),
            });
          }
        }
      } finally {
        setDeletingProjects((prev) => {
          const next = new Set(prev);
          for (const projectId of projectIds) {
            next.delete(projectId);
          }
          return next;
        });
      }

      if (failures.length === 0) {
        return;
      }

      // A single target keeps its own message. Server text is concatenated
      // rather than interpolated, because i18next escapes interpolated values
      // and would mangle the quotes in git's own wording.
      if (targets.length === 1) {
        alert(failures[0].reason);
        return;
      }

      const heading = t('messages.deleteProjectsPartial', {
        removed,
        failed: failures.length,
        defaultValue: 'Removed {{removed}}. Failed on {{failed}}:',
      });
      alert(`${heading}\n\n${failures.map(({ name, reason }) => `• ${name} — ${reason}`).join('\n')}`);
    },
    [onProjectDelete, t],
  );

  const confirmDeleteProject = useCallback(async (deleteData = false) => {
    if (!deleteConfirmation) {
      return;
    }

    const { projects: targets } = deleteConfirmation;
    setDeleteConfirmation(null);
    await deleteProjects(targets, deleteData);
  }, [deleteConfirmation, deleteProjects]);

  /**
   * Archives without a confirmation step: archiving is reversible from the
   * Archive view, so a modal would only be in the way.
   */
  const archiveProjects = useCallback(
    (targets: Project[]) => {
      void deleteProjects(targets, false);
    },
    [deleteProjects],
  );

  /** Renames one project outside the sidebar's inline-edit flow. */
  const renameProjectDirect = useCallback(
    async (projectId: string, displayName: string) => {
      const trimmed = displayName.trim();
      if (!trimmed) {
        return;
      }

      try {
        const response = await api.renameProject(projectId, trimmed);
        if (!response.ok) {
          alert(t('messages.renameProjectFailed', 'Failed to rename project'));
          return;
        }

        await onRefresh?.();
      } catch (error) {
        console.error('[Sidebar] Error renaming project:', error);
        alert(t('messages.renameProjectFailed', 'Failed to rename project'));
      }
    },
    [onRefresh, t],
  );

  /**
   * Adds a worktree to a repository: git creates the tree, the server registers
   * it, and the refresh brings it into the row it belongs to.
   *
   * The two steps come back separately, because the tree exists on disk as soon
   * as git succeeds. A thrown error therefore means *no worktree was created*;
   * a returned `registrationError` means one was, and CLIde could not adopt it.
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
        const err = data.error;
        // git's own refusal is carried in `details` and is the actionable part.
        const message =
          typeof err === 'string'
            ? err
            : err?.details || err?.message || t('messages.createWorktreeFailed', 'Failed to create worktree');
        throw new Error(message);
      }

      const payload = (await response.json().catch(() => ({}))) as {
        data?: {
          worktreePath?: string;
          project?: Project | null;
          registrationError?: string | null;
        };
      };

      await onRefresh?.();

      return {
        worktreePath: payload.data?.worktreePath ?? '',
        project: payload.data?.project ?? null,
        registrationError: payload.data?.registrationError ?? null,
      };
    },
    [onRefresh, t],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const openArchivedSession = useCallback((session: ArchivedSessionListItem) => {
    const activeProject = session.projectId
      ? projects.find((candidate) => candidate.projectId === session.projectId)
      : null;
    const archivedProject = session.projectId
      ? archivedProjects.find((candidate) => candidate.projectId === session.projectId)
      : null;
    const matchingProject = activeProject ?? archivedProject ?? null;
    const sessionPayload: ProjectSession = {
      id: session.sessionId,
      summary: session.sessionTitle,
      __provider: session.provider,
      __projectId: matchingProject?.projectId ?? session.projectId ?? undefined,
    };

    // Archived sessions still need a selected project context. Active projects
    // come from the normal sidebar list, while archived-project sessions resolve
    // through the archive payload loaded by this controller.
    if (matchingProject) {
      handleProjectSelect(matchingProject);
    }

    onSessionSelect(sessionPayload);
    clearSearchFilter();
  }, [archivedProjects, clearSearchFilter, handleProjectSelect, onSessionSelect, projects]);

  const restoreArchivedProject = useCallback(async (projectId: string) => {
    try {
      const response = await api.restoreProject(projectId);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to restore project:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.restoreProjectFailed', 'Failed to restore project. Please try again.'));
        return;
      }

      await Promise.all([
        Promise.resolve(onRefresh()),
        fetchArchivedSessions(),
      ]);
    } catch (error) {
      console.error('[Sidebar] Error restoring project:', error);
      alert(t('messages.restoreProjectError', 'Error restoring project. Please try again.'));
    }
  }, [fetchArchivedSessions, onRefresh, t]);

  const restoreArchivedSession = useCallback(async (sessionId: string) => {
    try {
      const response = await api.restoreSession(sessionId);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to restore session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.restoreSessionFailed', 'Failed to restore session. Please try again.'));
        return;
      }

      await Promise.all([
        Promise.resolve(onRefresh()),
        fetchArchivedSessions(),
      ]);
    } catch (error) {
      console.error('[Sidebar] Error restoring session:', error);
      alert(t('messages.restoreSessionError', 'Error restoring session. Please try again.'));
    }
  }, [fetchArchivedSessions, onRefresh, t]);

  const updateSessionSummary = useCallback(
    // `_projectId` and `_provider` are preserved for compatibility with
    // existing sidebar callback signatures; backend rename only needs sessionId.
    async (_projectId: string, sessionId: string, summary: string, _provider: LLMProvider) => {
      const trimmed = summary.trim();
      if (!trimmed) {
        setEditingSession(null);
        setEditingSessionName('');
        return;
      }
      try {
        const response = await api.renameSession(sessionId, trimmed);
        if (response.ok) {
          await onRefresh();
        } else {
          console.error('[Sidebar] Failed to rename session:', response.status);
          alert(t('messages.renameSessionFailed'));
        }
      } catch (error) {
        console.error('[Sidebar] Error renaming session:', error);
        alert(t('messages.renameSessionError'));
      } finally {
        setEditingSession(null);
        setEditingSessionName('');
      }
    },
    [onRefresh, t],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    loadingMoreProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    repositoryEntries,
    activitySessions,
    activitySummary,
    isActivitySectionCollapsed,
    toggleActivitySection,
    pinnedSessions,
    isPinnedSectionCollapsed,
    togglePinnedSection,
    isSessionSearchActive,
    archivedProjects: filteredArchivedProjects,
    archivedSessions: filteredArchivedSessions,
    archivedSessionsCount: archivedProjects.length + archivedSessions.length,
    isArchivedSessionsLoading,
    toggleProject,
    handleSessionClick,
    getProjectSessions,
    getRepositorySessions,
    getRepositoryView,
    setRepositoryView,
    resetRepositoryView,
    loadMoreSessionsForProject,
    loadMoreSessionsForRepository,
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
    createWorktree,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults: useCallback(() => {
      searchSeqRef.current += 1;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsSearching(false);
      setSearchProgress(null);
      setConversationResults(null);
    }, []),
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
