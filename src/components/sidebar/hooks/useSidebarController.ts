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
  filterProjectsByRepositoryEntry,
  filterProjectsBySessionTitle,
  getAllSessions,
  getUnpinnedCheckoutSessions,
  isDefaultRepositoryView,
  readProjectSortOrder,
  repositoryEntryKey,
  sortProjects,
} from '../utils/utils';
import { getBatchSelectableWorktrees, getWorktreeSessionCount } from '../utils/worktreeManager';

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
  // Null keeps the ordinary all-projects view. A key scopes only the repository
  // rows; Activity and Pinned stay global so background work never disappears.
  const [projectFilterKey, setProjectFilterKey] = useState<string | null>(null);
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
  // Projects whose next session page is already being fetched.
  const inFlightSessionPagesRef = useRef<Set<string>>(new Set());
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
      // In a focused Projects view, following a global Activity/Pinned result
      // moves that focus to the session's repository. "All projects" remains
      // all: ordinary navigation must not silently turn the filter on.
      setProjectFilterKey((currentKey) => {
        if (currentKey === null) {
          return null;
        }

        const project = projects.find((candidate) => candidate.projectId === projectId);
        return project ? repositoryEntryKey(project) : currentKey;
      });
      // Tag the session with its owning projectId so downstream handlers
      // can correlate it with the selectedProject in the app state.
      onSessionSelect({ ...session, __projectId: projectId });
      clearSearchFilter();
    },
    [clearSearchFilter, onSessionSelect, projects],
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

    // In-flight guard is a ref, not the state set: React only runs a state
    // updater eagerly when nothing else is queued on that fiber, so deciding
    // inside the updater loses the race under a burst of pages — the call
    // returns early after the row is already marked loading, and nothing clears
    // it.
    if (inFlightSessionPagesRef.current.has(projectId)) {
      return;
    }

    inFlightSessionPagesRef.current.add(projectId);
    setLoadingMoreProjects((previous) => {
      if (previous.has(projectId)) {
        return previous;
      }

      const next = new Set(previous);
      next.add(projectId);
      return next;
    });

    try {
      await onLoadMoreSessions(projectId);
    } catch (error) {
      console.error('[Sidebar] Failed to load more sessions:', error);
      alert(t('messages.refreshError'));
    } finally {
      inFlightSessionPagesRef.current.delete(projectId);
      setLoadingMoreProjects((previous) => {
        const next = new Set(previous);
        next.delete(projectId);
        return next;
      });
    }
  }, [onLoadMoreSessions, t]);

  /**
   * Pagination is per checkout on the server, so one "load more" on a merged row
   * fans out to every checkout that still has sessions.
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
   * The five-session cap exists so one busy repository cannot push every other
   * project off screen; asking to see past it means the cap is not wanted. Sort
   * and filter need the whole set loaded anyway (see the effect below), so this
   * is the same fetch the view menu performs, reachable on its own.
   *
   * The page loop lives in that effect: marking the row starts it, and it stops
   * when no checkout reports more.
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
   * Puts one row back to its first page. Fetched sessions stay in memory, so
   * this only changes how many are drawn; dropping the row from
   * `fullyRevealedRows` is what stops the page loop.
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

  /**
   * Accent-colour picks applied before the server echoes them back.
   *
   * `projects` is owned by the caller and refetched wholesale, which is far too
   * heavy for a colour pick. Overriding here rather than at the row gives every
   * derived structure — picker entries, repository entries, filtered list — the
   * same value from one insertion point.
   */
  const [accentColorOverrides, setAccentColorOverrides] = useState<Record<string, string | null>>({});

  // Drop an override once a refresh carries the same value back, so a colour
  // changed on another device is not masked by a stale local pick.
  useEffect(() => {
    setAccentColorOverrides((currentOverrides) => {
      const unreconciled = Object.entries(currentOverrides).filter(([projectId, accentColor]) => {
        const project = projects.find((candidate) => candidate.projectId === projectId);
        return !project || (project.accentColor ?? null) !== accentColor;
      });

      return unreconciled.length === Object.keys(currentOverrides).length
        ? currentOverrides
        : Object.fromEntries(unreconciled);
    });
  }, [projects]);

  const projectsWithAccentOverrides = useMemo(() => {
    if (Object.keys(accentColorOverrides).length === 0) {
      return projects;
    }

    return projects.map((project) =>
      project.projectId in accentColorOverrides
        ? { ...project, accentColor: accentColorOverrides[project.projectId] }
        : project,
    );
  }, [accentColorOverrides, projects]);

  const sortedProjects = useMemo(
    () => sortProjects(projectsWithAccentOverrides, projectSortOrder),
    [projectSortOrder, projectsWithAccentOverrides],
  );

  const filteredProjects = useMemo(
    () => filterProjectsBySessionTitle(sortedProjects, debouncedSearchQuery),
    [debouncedSearchQuery, sortedProjects],
  );

  // The picker is independent of session search. Searching inside one project
  // must not make the other choices disappear from the menu.
  const projectPickerEntries = useMemo(
    () => buildRepositoryEntries(sortedProjects),
    [sortedProjects],
  );

  useEffect(() => {
    if (
      projectFilterKey !== null &&
      !projectPickerEntries.some((entry) => entry.key === projectFilterKey)
    ) {
      setProjectFilterKey(null);
    }
  }, [projectFilterKey, projectPickerEntries]);

  const selectProjectFilter = useCallback((entryKey: string | null) => {
    setProjectFilterKey(entryKey);

    if (entryKey === null) {
      return;
    }

    setExpandedProjects((previous) => {
      if (previous.has(entryKey)) {
        return previous;
      }

      const next = new Set(previous);
      next.add(entryKey);
      return next;
    });
  }, []);

  const scopedFilteredProjects = useMemo(
    () => filterProjectsByRepositoryEntry(filteredProjects, projectFilterKey),
    [filteredProjects, projectFilterKey],
  );

  /**
   * True while a typed query is narrowing rows to matching sessions. Rows open
   * themselves for it: an unseen match is the same as no match.
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
   * A row that matched only through a pinned session has nothing left to list
   * and the match is already visible above, so it drops out rather than reading
   * as a dead end.
   */
  const repositoryEntries = useMemo(() => {
    const searchableEntries = !isSessionSearchActive
      ? allRepositoryEntries
      : allRepositoryEntries.filter(
      (entry) => getUnpinnedCheckoutSessions(entry).length > 0,
    );

    return projectFilterKey === null
      ? searchableEntries
      : searchableEntries.filter((entry) => entry.key === projectFilterKey);
  }, [allRepositoryEntries, isSessionSearchActive, projectFilterKey]);

  /**
   * A sorted or filtered row loads every session it has before it answers.
   *
   * The server pages sessions (`isStarred DESC`, then newest first), so sorting
   * or filtering one page answers from five sessions out of forty. Each arriving
   * page re-runs this; it stops once no checkout has more.
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

  // Archive skips the confirmation modal — it is recoverable from the Archive
  // tab (mirrors confirmDeleteSession's soft-delete path, hardDelete=false).
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

  // Optimistic star toggle: flip the icon immediately (which also pins the
  // session via `getAllSessions`' starred-first sort), reconcile with the
  // server's returned flag, revert on failure. No sequence guard needed — pin
  // order follows `isStarred` directly, not a separate ordering map.
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

  /** Confirms permanent CLIde-data deletion for worktrees selected in the manager. */
  const requestProjectDelete = useCallback(
    (targets: Project[]) => {
      if (targets.length === 0) {
        return;
      }
      setDeleteConfirmation({
        projects: targets,
        displayName: targets.length === 1
          ? targets[0].displayName || targets[0].projectId
          : t('worktrees.selectedWorktrees', {
              count: targets.length,
              defaultValue: '{{count}} worktrees',
            }),
        sessionCount: targets.reduce((total, project) => total + getWorktreeSessionCount(project), 0),
        allowArchive: false,
      });
    },
    [t],
  );

  /**
   * Confirms removal of a whole repository row, every worktree included.
   * Deleting only the lead would leave the other worktrees behind as rows of
   * their own.
   */
  const requestRepositoryDelete = useCallback(
    (entry: RepositoryEntry) => {
      // Discovered checkouts have no row to delete, so a synthetic id would only
      // come back as a failure in the report.
      const registered = getBatchSelectableWorktrees(entry.checkouts);
      setDeleteConfirmation({
        projects: registered,
        displayName: entry.displayName,
        sessionCount: registered.reduce(
          (total, checkout) => total + getWorktreeSessionCount(checkout),
          0,
        ),
        coversRepository: true,
      });
    },
    [],
  );

  /**
   * Archives or removes every project in `targets`. `deleteData` is the
   * destructive branch: drops the DB row and the provider transcripts. Neither
   * branch touches the directory on disk.
   *
   * A repository row's delete covers every worktree, so this is a batch. ADR
   * 0017's preflight-then-rollback does not transfer — a hard delete has nothing
   * to roll back to — but its point does: every target is attempted and the
   * report names each failure, rather than stopping at the first.
   */
  const deleteProjects = useCallback(
    async (targets: Project[], deleteData: boolean) => {
      const projectIds = targets.map((target) => target.projectId);
      // Track in-flight deletes by projectId, so the UI can disable actions even
      // if the project object is rebuilt mid-request.
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

      // Server text is concatenated rather than interpolated: i18next escapes
      // interpolated values and would mangle the quotes in git's own wording.
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
   * Archives without confirmation: archiving is reversible from the Archive
   * view, so a modal would only be in the way.
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
   * Sets a project's highlight colour, or clears it with null.
   *
   * Optimistic and deliberately without a refresh: the strip repaints from the
   * override, and a failure restores the previous colour rather than leaving a
   * colour that was never saved.
   */
  const setProjectAccentColor = useCallback(
    (projectId: string, accentColor: string | null, previousAccentColor: string | null) => {
      setAccentColorOverrides((currentOverrides) => ({
        ...currentOverrides,
        [projectId]: accentColor,
      }));

      const run = async () => {
        try {
          const response = await api.setProjectAccentColor(projectId, accentColor);
          if (!response.ok) {
            throw new Error(`Accent colour update failed with status ${response.status}`);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to set project accent colour:', error);
          setAccentColorOverrides((currentOverrides) => ({
            ...currentOverrides,
            [projectId]: previousAccentColor,
          }));
        }
      };

      void run();
    },
    [],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setProjectFilterKey((currentKey) =>
        currentKey === null ? null : repositoryEntryKey(project),
      );
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
    filteredProjects: scopedFilteredProjects,
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
    setProjectAccentColor,
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
