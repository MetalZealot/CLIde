import type { TFunction } from 'i18next';

import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type {
  ProjectSortOrder,
  RepositoryGroup,
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

const LEGACY_STARRED_PROJECTS_STORAGE_KEY = 'starredProjects';

/**
 * Reads legacy project stars from localStorage (used only for one-time migration to backend).
 */
export const readLegacyStarredProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

/**
 * Clears the legacy localStorage stars key after migration to backend completes.
 */
export const clearLegacyStarredProjectIds = () => {
  try {
    localStorage.removeItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
  } catch {
    // Keep UI responsive even if storage is unavailable.
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
 * most-recent-activity order. Mirrors the starred-first behaviour of
 * `sortProjects` so the Projects and Conversations tabs behave consistently.
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

  byName.sort((projectA, projectB) => {
    // Star order now comes from backend `projects.isStarred`.
    const aStarred = Boolean(projectA.isStarred);
    const bStarred = Boolean(projectB.isStarred);

    if (aStarred && !bStarred) {
      return -1;
    }

    if (!aStarred && bStarred) {
      return 1;
    }

    if (projectSortOrder === 'date') {
      return getProjectLastActivity(projectB).getTime() - getProjectLastActivity(projectA).getTime();
    }

    return (projectA.displayName || projectA.projectId).localeCompare(projectB.displayName || projectB.projectId);
  });

  return byName;
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => {
    const displayName = (project.displayName || project.projectId).toLowerCase();
    // `project.path`/`fullPath` is the most useful search target now that the
    // folder-derived name is gone; fall back to displayName above.
    const searchPath = (project.path || project.fullPath || '').toLowerCase();
    // Branch is searchable because once several checkouts of one repository are
    // on screen, the branch is often the only thing that distinguishes them.
    const branch = (project.branch || '').toLowerCase();
    return (
      displayName.includes(normalizedSearch) ||
      searchPath.includes(normalizedSearch) ||
      (branch.length > 0 && branch.includes(normalizedSearch))
    );
  });
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
 * Groups an already-sorted, already-filtered project list by repository (ADR 0016).
 *
 * Order is preserved: a group takes the position of its highest-sorted member,
 * so changing the sort order or starring a checkout still moves it where the
 * user expects. Within a group the main checkout leads, because it owns the
 * repository's shared git directory.
 */
export const groupProjectsByRepository = (projects: Project[]): RepositoryGroup[] => {
  const checkoutsByRepository = new Map<string, Project[]>();
  for (const project of projects) {
    const repositoryId = typeof project.repositoryId === 'string' ? project.repositoryId : null;
    if (!repositoryId) {
      continue;
    }

    const existing = checkoutsByRepository.get(repositoryId);
    if (existing) {
      existing.push(project);
    } else {
      checkoutsByRepository.set(repositoryId, [project]);
    }
  }

  const groups: RepositoryGroup[] = [];
  const emittedRepositories = new Set<string>();

  for (const project of projects) {
    const repositoryId = typeof project.repositoryId === 'string' ? project.repositoryId : null;
    const checkouts = repositoryId ? checkoutsByRepository.get(repositoryId) : undefined;

    // A repository with a single registered checkout is not a group: a header
    // above one row would add depth without telling the user anything.
    if (!repositoryId || !checkouts || checkouts.length < 2) {
      groups.push({
        key: project.projectId,
        repositoryId: null,
        repositoryName: project.displayName || project.projectId,
        checkouts: [project],
      });
      continue;
    }

    if (emittedRepositories.has(repositoryId)) {
      continue;
    }
    emittedRepositories.add(repositoryId);

    const mainCheckoutFirst = [...checkouts].sort(
      (a, b) => Number(isMainCheckout(b)) - Number(isMainCheckout(a)),
    );

    groups.push({
      key: repositoryId,
      repositoryId,
      repositoryName: deriveRepositoryName(repositoryId, checkouts),
      checkouts: mainCheckoutFirst,
    });
  }

  return groups;
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
