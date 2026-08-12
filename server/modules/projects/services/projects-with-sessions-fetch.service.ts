import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { readCheckoutIdentity, type CheckoutIdentity } from './repository-identity.service.js';
import { discoverUnregisteredCheckouts } from './worktree-inventory.service.js';

type SessionSummary = {
  id: string;
  provider: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  isStarred: boolean;
};

type SessionRepositoryRow = {
  provider: string;
  session_id: string;
  custom_name?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  isStarred?: number | null;
};

export type ProjectListItem = {
  projectId: string;
  path: string;
  displayName: string;
  fullPath: string;
  isStarred: boolean;
  /** Palette token for the sidebar highlight; null when none is set. */
  accentColor: string | null;
  sessions: SessionSummary[];
  sessionMeta: {
    hasMore: boolean;
    total: number;
  };
  // ADR 0016: `repositoryId` groups several project rows into one repository in
  // the sidebar. Null for non-repositories, which stay ordinary flat projects.
  repositoryId: string | null;
  branch: string | null;
  detachedHead: string | null;
  /**
   * A worktree found on disk with no project row. Derived per request, never
   * stored, so its `projectId` is synthetic and no project-scoped operation may
   * address it until the user adopts it.
   */
  isDiscovered?: boolean;
};

// The archive is a flat historical view with no repository grouping. Omitting
// the fields is deliberate: an archived project's directory is often gone, and
// nulls would read as "not a repository" rather than "not grouped here".
export type ArchivedProjectListItem = Omit<
  ProjectListItem,
  'repositoryId' | 'branch' | 'detachedHead'
> & {
  isArchived: true;
};

type ProgressUpdate = {
  phase: 'loading' | 'complete';
  current: number;
  total: number;
  currentProject?: string;
};

type GetProjectsWithSessionsOptions = {
  skipSynchronization?: boolean;
  sessionsLimit?: number;
  sessionsOffset?: number;
};

type SessionPaginationOptions = {
  limit?: number;
  offset?: number;
};

type ProjectSessionsPageResult = {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
};

export type ProjectSessionsPageApiView = {
  projectId: string;
  sessions: SessionSummary[];
  sessionMeta: {
    hasMore: boolean;
    total: number;
  };
};

const DEFAULT_PROJECT_SESSIONS_PAGE_SIZE = 20;
const MAX_PROJECT_SESSIONS_PAGE_SIZE = 200;

/**
 * Generate better display name from path.
 */
export async function generateDisplayName(projectName: string, actualProjectDir: string | null = null): Promise<string> {
  // Use actual project directory if provided, otherwise decode from project name.
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path.
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData) as { name?: string };

    // Return the name from package.json if it exists.
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // Fall back to path-based naming if package.json doesn't exist or can't be read.
  }

  // If it starts with /, it's an absolute path.
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name.
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

function normalizeSessionPagination(options: SessionPaginationOptions = {}): { limit: number; offset: number } {
  const rawLimit = Number.isFinite(options.limit) ? Math.floor(Number(options.limit)) : DEFAULT_PROJECT_SESSIONS_PAGE_SIZE;
  const rawOffset = Number.isFinite(options.offset) ? Math.floor(Number(options.offset)) : 0;

  return {
    limit: Math.min(Math.max(1, rawLimit), MAX_PROJECT_SESSIONS_PAGE_SIZE),
    offset: Math.max(0, rawOffset),
  };
}

function mapSessionRowToSummary(row: SessionRepositoryRow): SessionSummary {
  return {
    id: row.session_id,
    provider: row.provider,
    summary: row.custom_name || '',
    messageCount: 0,
    lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    isStarred: Boolean(row.isStarred),
  };
}

function readProjectSessionsIncludingArchived(projectPath: string): ProjectSessionsPageResult {
  const rows = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath) as SessionRepositoryRow[];

  return {
    sessions: rows.map(mapSessionRowToSummary),
    total: rows.length,
    hasMore: false,
  };
}

/**
 * Reads one paginated project session slice from the DB and groups rows by provider.
 */
function readProjectSessionsPageByPath(
  projectPath: string,
  options: SessionPaginationOptions = {},
): ProjectSessionsPageResult {
  const pagination = normalizeSessionPagination(options);
  const rows = sessionsDb.getSessionsByProjectPathPage(
    projectPath,
    pagination.limit,
    pagination.offset,
  ) as SessionRepositoryRow[];
  const total = sessionsDb.countSessionsByProjectPath(projectPath);

  return {
    sessions: rows.map(mapSessionRowToSummary),
    total,
    hasMore: pagination.offset + rows.length < total,
  };
}

// Broadcast progress to all connected WebSocket clients.
// Uses the unified `kind` envelope like every other websocket frame.
function broadcastProgress(progress: ProgressUpdate) {
  const message = JSON.stringify({
    kind: 'loading_progress',
    ...progress,
  });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(message);
    }
  });
}

const NO_CHECKOUT_IDENTITY: CheckoutIdentity = {
  repositoryId: null,
  branch: null,
  detachedHead: null,
};

/**
 * How many identity reads run at once.
 *
 * Each spawns git, so reading them inside the sequential project loop makes the
 * list as slow as the project count, while a flat `Promise.all` forks one process
 * per project at once. `readCheckoutIdentity` never rejects, so no settling
 * wrapper is needed.
 */
const IDENTITY_READ_CONCURRENCY = 8;

async function readCheckoutIdentities(
  projectPaths: string[],
): Promise<Map<string, CheckoutIdentity>> {
  const identities = new Map<string, CheckoutIdentity>();

  for (let index = 0; index < projectPaths.length; index += IDENTITY_READ_CONCURRENCY) {
    const batch = projectPaths.slice(index, index + IDENTITY_READ_CONCURRENCY);
    const read = await Promise.all(batch.map((projectPath) => readCheckoutIdentity(projectPath)));
    batch.forEach((projectPath, offset) => identities.set(projectPath, read[offset]));
  }

  return identities;
}

/**
 * Marks a list entry that exists only for this response. Nothing persistent may
 * be keyed by it; the client uses the prefix to keep project-scoped actions away
 * from a checkout with no row to act on.
 */
export const DISCOVERED_PROJECT_ID_PREFIX = 'discovered:';

/**
 * Worktrees of the already-listed repositories that have no project row.
 *
 * One `git worktree list` per repository rather than per project, since any
 * checkout reports the whole repository. Identity for each discovery goes
 * through `readCheckoutIdentity` rather than the porcelain output, so its
 * `repositoryId` comes from the same code that produced the registered rows' —
 * which is what makes the client's grouping join work.
 */
async function readDiscoveredCheckouts(
  registeredPaths: string[],
  checkoutIdentities: Map<string, CheckoutIdentity>,
): Promise<ProjectListItem[]> {
  const probePathByRepository = new Map<string, string>();
  for (const projectPath of registeredPaths) {
    const repositoryId = checkoutIdentities.get(projectPath)?.repositoryId;
    if (!repositoryId || probePathByRepository.has(repositoryId)) {
      continue;
    }
    probePathByRepository.set(repositoryId, projectPath);
  }

  if (probePathByRepository.size === 0) {
    return [];
  }

  const entries = await discoverUnregisteredCheckouts({
    repositoryProbePaths: [...probePathByRepository.values()],
    // Archived rows count: `getProjectPath` deliberately ignores `isArchived`.
    isRegistered: (checkoutPath) => Boolean(projectsDb.getProjectPath(checkoutPath)),
  });

  if (entries.length === 0) {
    return [];
  }

  const identities = await readCheckoutIdentities(entries.map((entry) => entry.path));

  const discovered: ProjectListItem[] = [];
  for (const entry of entries) {
    const identity = identities.get(entry.path) ?? NO_CHECKOUT_IDENTITY;
    // No identity means git stopped agreeing this is a checkout between the two
    // calls. Listing it ungrouped would strand a row nothing can adopt.
    if (!identity.repositoryId) {
      continue;
    }

    discovered.push({
      projectId: `${DISCOVERED_PROJECT_ID_PREFIX}${entry.path}`,
      path: entry.path,
      // The directory name, not `generateDisplayName`: every checkout shares one
      // `package.json`, so the derived name is identical for all of them. Also
      // matches what `createProject` stores when the checkout is adopted.
      displayName: path.basename(entry.path) || entry.path,
      fullPath: entry.path,
      isStarred: false,
      accentColor: null,
      sessions: [],
      sessionMeta: {
        hasMore: false,
        total: 0,
      },
      repositoryId: identity.repositoryId,
      branch: identity.branch,
      detachedHead: identity.detachedHead,
      isDiscovered: true,
    });
  }

  return discovered;
}

/**
 * Reads all projects from DB and returns normalized session summaries.
 */
export async function getProjectsWithSessions(
  options: GetProjectsWithSessionsOptions = {}
): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
    accent_color?: string | null;
  }>;
  const totalProjects = projectRows.length;
  const projects: ProjectListItem[] = [];
  let processedProjects = 0;

  const checkoutIdentities = await readCheckoutIdentities(projectRows.map((row) => row.project_path));

  for (const row of projectRows) {
    processedProjects += 1;

    const projectId = row.project_id;
    const projectPath = row.project_path;

    broadcastProgress({
      phase: 'loading',
      current: processedProjects,
      total: totalProjects,
      currentProject: projectPath,
    });

    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath);

    const sessionsPage = readProjectSessionsPageByPath(projectPath, {
      limit: options.sessionsLimit,
      offset: options.sessionsOffset,
    });

    const checkoutIdentity = checkoutIdentities.get(projectPath) ?? NO_CHECKOUT_IDENTITY;

    projects.push({
      projectId,
      path: projectPath,
      displayName,
      fullPath: projectPath,
      isStarred: Boolean(row.isStarred),
      accentColor: row.accent_color ?? null,
      sessions: sessionsPage.sessions,
      sessionMeta: {
        hasMore: sessionsPage.hasMore,
        total: sessionsPage.total,
      },
      repositoryId: checkoutIdentity.repositoryId,
      branch: checkoutIdentity.branch,
      detachedHead: checkoutIdentity.detachedHead,
    });
  }

  projects.push(
    ...(await readDiscoveredCheckouts(
      projectRows.map((row) => row.project_path),
      checkoutIdentities,
    )),
  );

  broadcastProgress({
    phase: 'complete',
    current: totalProjects,
    total: totalProjects,
  });

  return projects;
}

/**
 * Reads archived projects from DB and includes every session row for each
 * project path, because an archived workspace should surface all preserved
 * conversation history in the archive view regardless of each session's flag.
 */
export async function getArchivedProjectsWithSessions(
  options: Pick<GetProjectsWithSessionsOptions, 'skipSynchronization'> = {},
): Promise<ArchivedProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getArchivedProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
    accent_color?: string | null;
  }>;

  const archivedProjects: ArchivedProjectListItem[] = [];

  for (const row of projectRows) {
    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(row.project_path) || row.project_path, row.project_path);

    const sessionsPage = readProjectSessionsIncludingArchived(row.project_path);

    archivedProjects.push({
      projectId: row.project_id,
      path: row.project_path,
      displayName,
      fullPath: row.project_path,
      isStarred: Boolean(row.isStarred),
      accentColor: row.accent_color ?? null,
      isArchived: true,
      sessions: sessionsPage.sessions,
      sessionMeta: {
        hasMore: sessionsPage.hasMore,
        total: sessionsPage.total,
      },
    });
  }

  return archivedProjects;
}

/**
 * Loads one paginated session slice for a specific project id.
 */
export async function getProjectSessionsPage(
  projectId: string,
  options: SessionPaginationOptions = {},
): Promise<ProjectSessionsPageApiView> {
  const projectRow = projectsDb.getProjectById(projectId);
  if (!projectRow) {
    throw new AppError(`Project "${projectId}" was not found.`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const sessionsPage = readProjectSessionsPageByPath(projectRow.project_path, options);
  return {
    projectId: projectRow.project_id,
    sessions: sessionsPage.sessions,
    sessionMeta: {
      hasMore: sessionsPage.hasMore,
      total: sessionsPage.total,
    },
  };
}
