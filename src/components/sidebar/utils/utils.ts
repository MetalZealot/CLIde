import type { TFunction } from 'i18next';

import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type {
  ActivitySession,
  CheckoutSession,
  PinnedSession,
  ProjectSortOrder,
  RepositoryEntry,
  RepositoryViewOptions,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'name';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return settings.projectSortOrder === 'date' ? 'date' : 'name';
  } catch {
    return 'name';
  }
};

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
 * The sidebar lifts pinned sessions out into their own section, so the starred
 * tier rarely fires there; it still governs every other session list, and it
 * matches the server's own `isStarred DESC` page order, which is what
 * guarantees a pinned session is never stranded behind pagination.
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

export const sortProjects = (
  projects: Project[],
  projectSortOrder: ProjectSortOrder,
): Project[] => {
  const byName = [...projects];

  // No starred-first tier: pinning belongs to sessions only (decided
  // 2026-08-05), so a repository's position is its sort order and nothing else.
  byName.sort((projectA, projectB) => {
    if (projectSortOrder === 'date') {
      return getProjectLastActivity(projectB).getTime() - getProjectLastActivity(projectA).getTime();
    }

    return (projectA.displayName || projectA.projectId).localeCompare(projectB.displayName || projectB.projectId);
  });

  return byName;
};

/**
 * Narrows each project to the sessions whose title matches, dropping projects
 * that keep none.
 *
 * Search deliberately no longer matches project names, paths, or branches
 * (decided 2026-08-05). Repositories are a short, permanently visible list —
 * collapsing their worktrees into one row was itself the fix for a long
 * sidebar — so the thing actually worth finding is a session.
 *
 * Only sessions already loaded into the row can match; the server paginates
 * them. "Search inside messages" is what reaches further back.
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
      // The row's count and its "show more" have to describe the matches, not
      // the full list the server paginated — same shape the running filter uses.
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
 * stripping that suffix names the main checkout's directory. Returns null for
 * layouts where that does not hold — a bare repository, or one created with
 * `--separate-git-dir` — and then no checkout is treated as the main one.
 */
const deriveMainCheckoutPath = (repositoryId: string): string | null => {
  const withoutGitSuffix = repositoryId.replace(/\/\.git\/?$/, '');
  return withoutGitSuffix === repositoryId ? null : withoutGitSuffix;
};

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
 * Branch label for a checkout, or a short SHA when HEAD is detached.
 *
 * Detached HEAD is deliberately not shown as a branch called `HEAD`; the Git
 * panel does that and ADR 0016 lists it as a truthfulness defect.
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
 * Which sidebar row a project belongs to.
 *
 * Deliberately a pure function of the project alone. Deriving it from the
 * visible list instead would let a search that hides one checkout silently
 * re-key the surviving one, collapsing the row the user had open.
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
  // directory that contains the shared git dir.
  const mainPath = deriveMainCheckoutPath(repositoryId) ?? repositoryId;
  return mainPath.split('/').filter(Boolean).pop() || repositoryId;
};

/**
 * Collapses an already-sorted, already-filtered project list into one row per
 * repository (ADR 0016).
 *
 * Order is preserved: an entry takes the position of its highest-sorted
 * checkout, so changing the sort order or starring a worktree still moves the
 * row where the user expects. The main checkout leads, because it owns the
 * repository's shared git directory and is the sane default for
 * repository-scoped actions.
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

    const checkouts = [...(checkoutsByKey.get(key) ?? [project])].sort(
      (a, b) => Number(isMainCheckout(b)) - Number(isMainCheckout(a)),
    );
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
 * Keeps the raw project rows belonging to one visible repository entry.
 *
 * The sidebar still needs raw rows for loading/empty state, while its picker
 * exposes repository rows. Matching through the shared entry key preserves
 * every worktree in a selected repository instead of picking only its lead.
 */
export const filterProjectsByRepositoryEntry = (
  projects: Project[],
  entryKey: string | null,
): Project[] => {
  if (entryKey === null) {
    return projects;
  }

  return projects.filter((project) => repositoryEntryKey(project) === entryKey);
};

/**
 * Every session across an entry's checkouts, newest first, starred pinned to
 * the top — the flattened list that replaces a tier of checkout rows.
 *
 * The branch label is attached here rather than read off the row's own project
 * so that a single-checkout entry stays free of a redundant label: there is
 * nothing to disambiguate it from.
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

/**
 * The sessions a repository row actually lists: its merged sessions minus the
 * pinned ones.
 *
 * A pinned session is *moved* into the Pinned section, not copied there
 * (decided 2026-08-05) — one session, one row, so nothing is ever read twice
 * or unpinned from a place it appears to still be in.
 */
export const getUnpinnedCheckoutSessions = (entry: RepositoryEntry): CheckoutSession[] => {
  return mergeCheckoutSessions(entry).filter(({ session }) => !session.isStarred);
};

/**
 * Every pinned session across the visible rows, newest first, each tagged with
 * the repository it came from so it still says where it belongs.
 *
 * Built from the rows rather than from the raw project list so a search narrows
 * this section too, and so the branch label stays consistent with the row the
 * session left.
 */
export const collectPinnedSessions = (entries: RepositoryEntry[]): PinnedSession[] => {
  return entries
    .flatMap((entry) =>
      mergeCheckoutSessions(entry)
        .filter(({ session }) => session.isStarred)
        .map((checkoutSession) => ({ ...checkoutSession, repositoryName: entry.displayName })),
    )
    .sort((a, b) => getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime());
};

const ACTIVITY_URGENCY: Record<ActivitySession['activityState'], number> = {
  blocked: 0,
  unread: 1,
  running: 2,
};

/**
 * Every session with transient activity, grouped by urgency and newest first
 * within each group. Unlike Pinned, Activity copies sessions into its section:
 * transient work must not make repository rows jump in and out.
 */
export const collectActivitySessions = (
  entries: RepositoryEntry[],
  activeSessionIds: ReadonlySet<string>,
  attentionSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): ActivitySession[] => {
  return entries
    .flatMap((entry) =>
      mergeCheckoutSessions(entry).flatMap((checkoutSession) => {
        const sessionId = checkoutSession.session.id;
        const activityState: ActivitySession['activityState'] | null = attentionSessionIds.has(sessionId)
          ? 'blocked'
          : unreadSessionIds.has(sessionId)
            ? 'unread'
            : activeSessionIds.has(sessionId)
              ? 'running'
              : null;

        return activityState
          ? [{ ...checkoutSession, repositoryName: entry.displayName, activityState }]
          : [];
      }),
    )
    .sort((a, b) => {
      const urgencyDifference = ACTIVITY_URGENCY[a.activityState] - ACTIVITY_URGENCY[b.activityState];
      return urgencyDifference !== 0
        ? urgencyDifference
        : getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime();
    });
};

/** Newest first, every worktree shown — the order the row has always used. */
export const DEFAULT_REPOSITORY_VIEW_OPTIONS: RepositoryViewOptions = {
  sort: 'recent',
  worktreeProjectIds: null,
};

/** True when a row is presenting its sessions the plain way. */
export const isDefaultRepositoryView = (options: RepositoryViewOptions): boolean => {
  return options.sort === 'recent' && options.worktreeProjectIds === null;
};

/**
 * Applies one row's sort and worktree filter to its merged session list.
 *
 * Worktree ordering falls back to recency within a worktree, and names the
 * checkout by the same branch label the rows themselves show, so the groups
 * read in the order the eye expects. `title` uses the displayed name, fallback
 * included, rather than the raw summary — otherwise every unnamed session
 * sorts under the empty string while showing "New Session".
 */
export const applyRepositoryViewOptions = (
  sessions: CheckoutSession[],
  options: RepositoryViewOptions,
  t: TFunction,
): CheckoutSession[] => {
  const kept = options.worktreeProjectIds
    ? sessions.filter(({ checkout }) => options.worktreeProjectIds?.includes(checkout.projectId))
    : sessions;

  const byRecency = (a: CheckoutSession, b: CheckoutSession) =>
    getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime();

  const sorted = [...kept];

  switch (options.sort) {
    case 'oldest':
      sorted.sort((a, b) => -byRecency(a, b));
      break;
    case 'title':
      sorted.sort((a, b) =>
        getSessionName(a.session, t).localeCompare(getSessionName(b.session, t)),
      );
      break;
    case 'worktree':
      sorted.sort((a, b) => {
        const label = (entry: CheckoutSession) =>
          getCheckoutRefLabel(entry.checkout) ?? entry.checkout.displayName ?? entry.checkout.projectId;
        const byWorktree = label(a).localeCompare(label(b));
        return byWorktree !== 0 ? byWorktree : byRecency(a, b);
      });
      break;
    default:
      sorted.sort(byRecency);
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
