import type { TFunction } from 'i18next';

import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type {
  ActivityState,
  ActivitySummary,
  BrowseSessionViewOptions,
  BrowseSession,
  CheckoutSession,
  ProjectViewOptions,
  ProjectSortOrder,
  RepositoryEntry,
  RepositoryViewOptions,
  SessionSortDirection,
  SessionSortKey,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

export const DEFAULT_PROJECT_VIEW_OPTIONS: ProjectViewOptions = {
  sort: 'name',
  direction: 'asc',
};

export const DEFAULT_BROWSE_SESSION_VIEW_OPTIONS: BrowseSessionViewOptions = {
  sort: 'date',
  direction: 'desc',
};

const SIDEBAR_PROJECT_VIEW_STORAGE_KEY = 'sidebar-project-view-options';

export const readProjectViewOptions = (): ProjectViewOptions => {
  try {
    const stored = localStorage.getItem(SIDEBAR_PROJECT_VIEW_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ProjectViewOptions>;
      const sort = parsed.sort === 'date' ? 'date' : 'name';
      const direction = parsed.direction === 'desc' ? 'desc' : 'asc';
      return { sort, direction };
    }

    // Import the former Settings-owned value once, then the sidebar owns it.
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return DEFAULT_PROJECT_VIEW_OPTIONS;
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    const migrated: ProjectViewOptions = settings.projectSortOrder === 'date'
      ? { sort: 'date', direction: 'desc' }
      : DEFAULT_PROJECT_VIEW_OPTIONS;
    localStorage.setItem(SIDEBAR_PROJECT_VIEW_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_PROJECT_VIEW_OPTIONS;
  }
};

export const writeProjectViewOptions = (options: ProjectViewOptions): void => {
  try {
    localStorage.setItem(SIDEBAR_PROJECT_VIEW_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // The view still changes when storage is unavailable.
  }
};

export const isDefaultProjectView = (options: ProjectViewOptions): boolean =>
  options.sort === DEFAULT_PROJECT_VIEW_OPTIONS.sort
  && options.direction === DEFAULT_PROJECT_VIEW_OPTIONS.direction;

export const isDefaultBrowseSessionView = (options: BrowseSessionViewOptions): boolean =>
  options.sort === DEFAULT_BROWSE_SESSION_VIEW_OPTIONS.sort
  && options.direction === DEFAULT_BROWSE_SESSION_VIEW_OPTIONS.direction;

const getCreatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.createdAt || session.created_at || '');
};

const getUpdatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.lastActivity || '');
};

const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : 'claude';
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  return new Date(getUpdatedTimestamp(session) || getCreatedTimestamp(session) || 0);
};

/**
 * Sort comparator that pins starred sessions to the top, then falls back to
 * most-recent-activity order.
 *
 * This governs repository and flat Sessions lists and matches the server's
 * `isStarred DESC` page order, so a pin cannot be stranded behind pagination.
 */
export const compareSessionsStarredFirst = (
  a: SessionWithProvider,
  b: SessionWithProvider,
): number => {
  const aStarred = Boolean(a.isStarred);
  const bStarred = Boolean(b.isStarred);

  if (aStarred !== bStarred) {
    return aStarred ? -1 : 1;
  }

  return getSessionDate(b).getTime() - getSessionDate(a).getTime();
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  return session.summary || session.name || t('projects.newSession');
};

export const getSessionTime = (session: SessionWithProvider): string => {
  return getUpdatedTimestamp(session) || getCreatedTimestamp(session);
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));

  return {
    isActive: diffInMinutes < 10,
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: Number(session.messageCount || 0),
  };
};

export const getAllSessions = (project: Project): SessionWithProvider[] => {
  return (project.sessions || []).map((session) => ({
    ...session,
    __provider: getSessionProvider(session),
  })).sort(compareSessionsStarredFirst);
};

export const getProjectLastActivity = (project: Project): Date => {
  const sessions = getAllSessions(project);
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));
};

export const sortRepositoryEntries = (
  entries: RepositoryEntry[],
  options: ProjectViewOptions,
): RepositoryEntry[] => {
  const sorted = [...entries];
  const sign = options.direction === 'asc' ? 1 : -1;

  sorted.sort((entryA, entryB) => {
    if (options.sort === 'date') {
      const lastActivity = (entry: RepositoryEntry) => Math.max(
        ...entry.checkouts.map((checkout) => getProjectLastActivity(checkout).getTime()),
      );
      return sign * (lastActivity(entryA) - lastActivity(entryB));
    }

    return sign * entryA.displayName.localeCompare(entryB.displayName);
  });

  return sorted;
};

/**
 * Narrows each project to the sessions whose title matches, dropping projects
 * that keep none.
 *
 * Search does not match project names, paths, or branches: repositories are a
 * short, permanently visible list, so the thing worth finding is a session.
 * Only sessions already loaded into the row can match — the server paginates
 * them, and "search inside messages" is what reaches further back.
 */
export const filterProjectsBySessionTitle = (
  projects: Project[],
  searchFilter: string,
): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.reduce<Project[]>((matchingProjects, project) => {
    const sessions = (project.sessions || []).filter((session) =>
      String(session.summary || session.name || '')
        .toLowerCase()
        .includes(normalizedSearch),
    );

    if (sessions.length === 0) {
      return matchingProjects;
    }

    matchingProjects.push({
      ...project,
      sessions,
      // Count and "show more" describe the matches, not the full list the
      // server paginated.
      sessionMeta: {
        ...project.sessionMeta,
        total: sessions.length,
        hasMore: false,
      },
    });

    return matchingProjects;
  }, []);
};

/**
 * Directory of the main checkout of the repository identified by `repositoryId`.
 *
 * A linked worktree's shared git directory is the *main* checkout's `.git`, so
 * stripping that suffix names its directory. Null for layouts where that does
 * not hold — a bare repository, or `--separate-git-dir` — and then no checkout
 * is treated as the main one.
 */
const deriveMainCheckoutPath = (repositoryId: string): string | null => {
  const withoutGitSuffix = repositoryId.replace(/\/\.git\/?$/, '');
  return withoutGitSuffix === repositoryId ? null : withoutGitSuffix;
};

/**
 * True for a checkout the projects API derived from `git worktree list` rather
 * than from a project row.
 */
export const isDiscoveredCheckout = (project: Project): boolean => project.isDiscovered === true;

/** True when this project is its repository's main checkout, not a linked worktree. */
export const isMainCheckout = (project: Project): boolean => {
  const repositoryId = typeof project.repositoryId === 'string' ? project.repositoryId : null;
  if (!repositoryId) {
    return false;
  }

  const mainPath = deriveMainCheckoutPath(repositoryId);
  return mainPath !== null && (project.fullPath === mainPath || project.path === mainPath);
};

/**
 * Which checkout leads its repository's row.
 *
 * Registered checkouts outrank discovered ones whatever git says about the main
 * worktree: the lead is the target of every repository-scoped action (rename,
 * accent colour, TaskMaster), and a discovered checkout's `projectId` is
 * synthetic, so addressing one would 404. Main-before-linked decides the rest;
 * the sort is stable, so anything past that keeps the caller's order.
 */
const compareCheckoutsForLead = (a: Project, b: Project): number => {
  const registration = Number(isDiscoveredCheckout(a)) - Number(isDiscoveredCheckout(b));
  if (registration !== 0) {
    return registration;
  }

  return Number(isMainCheckout(b)) - Number(isMainCheckout(a));
};

/**
 * Branch label for a checkout, or a short SHA when HEAD is detached. A detached
 * HEAD is deliberately not shown as a branch called `HEAD` — ADR 0016 lists that
 * as a truthfulness defect.
 */
export const getCheckoutRefLabel = (project: Project): string | null => {
  if (typeof project.branch === 'string' && project.branch.length > 0) {
    return project.branch;
  }

  if (typeof project.detachedHead === 'string' && project.detachedHead.length > 0) {
    return `detached @ ${project.detachedHead}`;
  }

  return null;
};

/**
 * Which sidebar row a project belongs to. Deliberately a pure function of the
 * project alone: deriving it from the visible list would let a search that hides
 * one checkout re-key the surviving one, collapsing the open row.
 */
export const repositoryEntryKey = (project: Project): string => {
  return typeof project.repositoryId === 'string' && project.repositoryId.length > 0
    ? project.repositoryId
    : project.projectId;
};

const deriveRepositoryName = (repositoryId: string, checkouts: Project[]): string => {
  const mainCheckout = checkouts.find(isMainCheckout);
  if (mainCheckout) {
    return mainCheckout.displayName || mainCheckout.projectId;
  }

  // The main checkout is not registered as a project here, so fall back to the
  // directory containing the shared git dir.
  const mainPath = deriveMainCheckoutPath(repositoryId) ?? repositoryId;
  return mainPath.split('/').filter(Boolean).pop() || repositoryId;
};

/**
 * How a header names the checkout it is showing, or null when that would be
 * noise.
 *
 * A single-checkout project is its own repository, so its name already answers
 * the question. Past one checkout — registered or discovered — one row covers
 * several working trees and the branch is what tells them apart.
 *
 * Counts by `repositoryEntryKey` rather than building the grouped entries, so it
 * stays cheap enough for every header render.
 */
export const getCheckoutContextLabel = (
  selectedProject: Project | null | undefined,
  projects: Project[],
): string | null => {
  if (!selectedProject) {
    return null;
  }

  const key = repositoryEntryKey(selectedProject);
  let checkoutCount = 0;
  for (const project of projects) {
    if (repositoryEntryKey(project) === key) {
      checkoutCount += 1;
    }
  }

  if (checkoutCount < 2) {
    return null;
  }

  const refLabel = getCheckoutRefLabel(selectedProject);
  const checkoutName = selectedProject.displayName || selectedProject.projectId;

  return refLabel ? `${checkoutName} · ${refLabel}` : checkoutName;
};

/**
 * Collapses an already-sorted, already-filtered project list into one row per
 * repository (ADR 0016).
 *
 * Order is preserved: an entry takes the position of its highest-sorted
 * checkout, so re-sorting or starring a worktree moves the row where expected.
 * The main checkout leads — it owns the shared git directory and is the default
 * target for repository-scoped actions.
 */
export const buildRepositoryEntries = (projects: Project[]): RepositoryEntry[] => {
  const checkoutsByKey = new Map<string, Project[]>();
  for (const project of projects) {
    const key = repositoryEntryKey(project);
    const existing = checkoutsByKey.get(key);
    if (existing) {
      existing.push(project);
    } else {
      checkoutsByKey.set(key, [project]);
    }
  }

  const entries: RepositoryEntry[] = [];
  const emitted = new Set<string>();

  for (const project of projects) {
    const key = repositoryEntryKey(project);
    if (emitted.has(key)) {
      continue;
    }
    emitted.add(key);

    const checkouts = [...(checkoutsByKey.get(key) ?? [project])].sort(compareCheckoutsForLead);
    const leadCheckout = checkouts[0];
    const repositoryId =
      typeof leadCheckout.repositoryId === 'string' && leadCheckout.repositoryId.length > 0
        ? leadCheckout.repositoryId
        : null;

    entries.push({
      key,
      repositoryId,
      displayName:
        repositoryId && checkouts.length > 1
          ? deriveRepositoryName(repositoryId, checkouts)
          : leadCheckout.displayName || leadCheckout.projectId,
      leadCheckout,
      checkouts,
    });
  }

  return entries;
};

/**
 * Every session across an entry's checkouts, newest first, starred pinned to the
 * top — the flattened list that replaces a tier of checkout rows.
 *
 * The branch label is attached here rather than read off the row's own project,
 * so a single-checkout entry stays free of a label with nothing to disambiguate.
 */
export const mergeCheckoutSessions = (entry: RepositoryEntry): CheckoutSession[] => {
  const needsBranchLabel = entry.checkouts.length > 1;

  return entry.checkouts
    .flatMap((checkout) => {
      const branchLabel = needsBranchLabel ? getCheckoutRefLabel(checkout) : null;
      return getAllSessions(checkout).map((session) => ({ session, checkout, branchLabel }));
    })
    .sort((a, b) => compareSessionsStarredFirst(a.session, b.session));
};

/** Every session across the visible repositories, pinned first then newest. */
export const collectBrowseSessions = (entries: RepositoryEntry[]): BrowseSession[] => {
  return entries
    .flatMap((entry) =>
      mergeCheckoutSessions(entry).map((checkoutSession) => ({
        ...checkoutSession,
        repositoryName: entry.displayName,
        repositoryAccentColor: entry.leadCheckout.accentColor,
      })),
    )
    .sort((a, b) => compareSessionsStarredFirst(a.session, b.session));
};

/** Applies the flat Sessions view without disturbing its pinned-first tier. */
export const applyBrowseSessionViewOptions = (
  sessions: BrowseSession[],
  options: BrowseSessionViewOptions,
  t: TFunction,
): BrowseSession[] => {
  const sign = options.direction === 'asc' ? 1 : -1;
  const pinnedFirst = (compare: (a: BrowseSession, b: BrowseSession) => number) =>
    (a: BrowseSession, b: BrowseSession) => {
      if (Boolean(a.session.isStarred) !== Boolean(b.session.isStarred)) {
        return a.session.isStarred ? -1 : 1;
      }
      return compare(a, b);
    };

  return [...sessions].sort(pinnedFirst((a, b) => {
    if (options.sort === 'title') {
      return sign * getSessionName(a.session, t).localeCompare(getSessionName(b.session, t));
    }
    if (options.sort === 'project') {
      const byProject = sign * a.repositoryName.localeCompare(b.repositoryName);
      return byProject !== 0 ? byProject : compareSessionsStarredFirst(a.session, b.session);
    }
    return sign * (getSessionDate(a.session).getTime() - getSessionDate(b.session).getTime());
  }));
};

/**
 * One visual state for every sidebar surface. A prompt that needs the user is
 * most urgent; otherwise a live run stays a spinner until it finishes, even if
 * unseen transcript output has already marked it unread.
 */
export const resolveActivityState = ({
  isProcessing,
  needsAttention,
  isUnread,
}: {
  isProcessing: boolean;
  needsAttention: boolean;
  isUnread: boolean;
}): ActivityState | null => {
  if (needsAttention) return 'blocked';
  if (isProcessing) return 'running';
  if (isUnread) return 'unread';
  return null;
};

/** Counts transient status without creating a second set of session rows. */
export const summarizeSessionActivity = (
  entries: RepositoryEntry[],
  activeSessionIds: ReadonlySet<string>,
  attentionSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): ActivitySummary => {
  return entries.reduce<ActivitySummary>((summary, entry) => {
    for (const { session } of mergeCheckoutSessions(entry)) {
      const activityState = resolveActivityState({
        isProcessing: activeSessionIds.has(session.id),
        needsAttention: attentionSessionIds.has(session.id),
        isUnread: unreadSessionIds.has(session.id),
      });
      if (activityState) {
        summary[activityState] += 1;
      }
    }
    return summary;
  }, { blocked: 0, unread: 0, running: 0 });
};

/** Newest first, every worktree shown — the order the row has always used. */
export const DEFAULT_REPOSITORY_VIEW_OPTIONS: RepositoryViewOptions = {
  sort: 'date',
  direction: 'desc',
  worktreeProjectIds: null,
};

/** The direction a field is first sorted in when you pick it. */
export const DEFAULT_SORT_DIRECTION: Record<SessionSortKey, SessionSortDirection> = {
  date: 'desc',
  title: 'asc',
  worktree: 'asc',
};

/** True when a row is presenting its sessions the plain way. */
export const isDefaultRepositoryView = (options: RepositoryViewOptions): boolean => {
  return (
    options.sort === 'date' && options.direction === 'desc' && options.worktreeProjectIds === null
  );
};

/**
 * Applies one row's sort and worktree filter to its merged session list.
 *
 * Within a worktree group the order stays newest first whichever way the group
 * labels run, and the checkout is named by the same branch label the rows show.
 * `title` uses the displayed name, fallback included, rather than the raw summary
 * — otherwise every unnamed session sorts under the empty string while showing
 * "New Session".
 */
export const applyRepositoryViewOptions = (
  sessions: CheckoutSession[],
  options: RepositoryViewOptions,
  t: TFunction,
): CheckoutSession[] => {
  const kept = options.worktreeProjectIds
    ? sessions.filter(({ checkout }) => options.worktreeProjectIds?.includes(checkout.projectId))
    : sessions;

  const oldestFirst = (a: CheckoutSession, b: CheckoutSession) =>
    getSessionDate(a.session).getTime() - getSessionDate(b.session).getTime();
  const sign = options.direction === 'asc' ? 1 : -1;
  const pinnedFirst = (
    fallback: (a: CheckoutSession, b: CheckoutSession) => number,
  ) => (a: CheckoutSession, b: CheckoutSession) => {
    const aPinned = Boolean(a.session.isStarred);
    const bPinned = Boolean(b.session.isStarred);
    return aPinned === bPinned ? fallback(a, b) : aPinned ? -1 : 1;
  };

  const sorted = [...kept];

  switch (options.sort) {
    case 'title':
      sorted.sort(
        pinnedFirst(
          (a, b) => sign * getSessionName(a.session, t).localeCompare(getSessionName(b.session, t)),
        ),
      );
      break;
    case 'worktree':
      sorted.sort(pinnedFirst((a, b) => {
        const label = (entry: CheckoutSession) =>
          getCheckoutRefLabel(entry.checkout) ?? entry.checkout.displayName ?? entry.checkout.projectId;
        const byWorktree = sign * label(a).localeCompare(label(b));
        return byWorktree !== 0 ? byWorktree : -oldestFirst(a, b);
      }));
      break;
    default:
      sorted.sort(pinnedFirst((a, b) => sign * oldestFirst(a, b)));
      break;
  }

  return sorted;
};

export const getTaskIndicatorStatus = (
  project: Project,
  mcpServerStatus: { hasMCPServer?: boolean; isConfigured?: boolean } | null,
) => {
  const projectConfigured = Boolean(project.taskmaster?.hasTaskmaster);
  const mcpConfigured = Boolean(mcpServerStatus?.hasMCPServer && mcpServerStatus?.isConfigured);

  if (projectConfigured && mcpConfigured) {
    return 'fully-configured';
  }

  if (projectConfigured) {
    return 'taskmaster-only';
  }

  if (mcpConfigured) {
    return 'mcp-only';
  }

  return 'not-configured';
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
        ? project.path
        : '';

  // Legacy SettingsProject still expects a `name` field; use the projectId so
  // downstream consumers that rely on a stable identifier continue to work.
  return {
    name: project.projectId,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.projectId,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
