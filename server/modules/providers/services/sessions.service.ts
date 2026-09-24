import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
  SideQuestionExchange,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  decodeHistoryImage,
  findTextHistoryMessage,
  HISTORY_PAGE_BUDGET_BYTES,
  measureHistoryMessage,
  slimHistoryMessage,
} from './history-payload.service.js';
import { paginateHistory } from './history-pagination.service.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
};

type ForkAppSessionResult = CreateAppSessionResult & {
  summary: string;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

type SessionDetails = {
  /** Canonical app-facing session id (may differ from the looked-up id when a provider-native id was given). */
  sessionId: string;
  provider: LLMProvider;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isArchived: boolean;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
    isArchived: boolean;
  } | null;
};

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
/**
 * Loads a session's complete normalized history by app session id.
 *
 * The provider adapter receives the provider-native session id; callers remap
 * returned records to the app id so provider ids never reach the frontend.
 */
async function loadFullHistory(
  sessionId: string,
  requireCompleteRead: boolean,
): Promise<{ result: FetchHistoryResult; identity: string }> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  const identity = JSON.stringify([sessionId, session.provider, session.provider_session_id, session.project_path ?? '', session.jsonl_path]);
  // App-created sessions that never produced a provider transcript yet
  // (e.g. first message still streaming) simply have no history.
  if (!session.provider_session_id) {
    return { result: { messages: [], total: 0, hasMore: false, offset: 0, limit: null }, identity };
  }

  const provider = session.provider as LLMProvider;
  const providerSessions = providerRegistry.resolveProvider(provider).sessions;
  const historyOptions: FetchHistoryOptions = {
    limit: null,
    offset: 0,
    projectPath: session.project_path ?? '',
    historyStartTime: session.created_at ?? undefined,
    requireCompleteRead,
    providerSessionId: session.provider_session_id,
  };

  let result: FetchHistoryResult;
  if (providerSessions.getHistorySourceRevision) {
    let fullHistory: FetchHistoryResult | null = null;
    try {
      fullHistory = await sessionHistoryCache.getFullHistory({
        sessionId,
        identity,
        getRevision: (previous) => providerSessions.getHistorySourceRevision!(
          sessionId,
          historyOptions,
          previous,
        ),
        loadFull: () => providerSessions.fetchHistory(sessionId, {
          ...historyOptions,
          limit: null,
          offset: 0,
          requireCompleteRead: true,
        }),
      });
    } catch {
      // Uncacheable sources use direct reads; bookmark reads still require completeness.
    }

    result = fullHistory ?? await providerSessions.fetchHistory(sessionId, historyOptions);
  } else {
    // Cursor and OpenCode need database-aware revisions before parsed history
    // can be reused safely; direct reads are the explicit correctness fallback.
    result = await providerSessions.fetchHistory(sessionId, historyOptions);
  }

  const current = sessionsDb.getSessionById(sessionId);
  if (!current || current.provider !== session.provider || current.provider_session_id !== session.provider_session_id
    || current.project_path !== session.project_path || current.jsonl_path !== session.jsonl_path) {
    throw new AppError('History identity changed during loading.', { code: 'HISTORY_CURSOR_INVALIDATED', statusCode: 409 });
  }
  return { result, identity };
}

export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return chatRunRegistry.listRunningRuns();
  },

  /**
   * Resolves the provider-native session id a runtime needs for resume.
   *
   * Callers hand provider runtimes the stable app session id; the provider
   * CLIs/SDKs only understand their own native id, which lives on the session
   * row. Ids without a row are assumed to be provider-native already (direct
   * API callers that reference sessions the watcher has not indexed yet).
   */
  resolveProviderSessionId(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    return session ? session.provider_session_id : sessionId;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run.
   */
  createAppSession(provider: LLMProvider, projectPath: string): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
    };
  },

  /**
   * Forks a provider conversation into a separate stable CLIde session.
   *
   * Unlike rewind, this preserves the source mapping. The provider creates
   * its native child first, then this method establishes a new app-facing row
   * that the frontend can navigate to immediately.
   */
  async forkSessionById(
    sourceSessionId: string,
    options: {
      model?: string;
      permissionMode?: string;
      lastTurnId?: string;
      title?: string;
      appendExchange?: SideQuestionExchange;
    } = {},
  ): Promise<ForkAppSessionResult> {
    const source = sessionsDb.getSessionById(sourceSessionId);
    if (!source) {
      throw new AppError(`Session "${sourceSessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!source.provider_session_id) {
      throw new AppError('This session has not started a provider conversation yet.', {
        code: 'SESSION_NOT_STARTED',
        statusCode: 409,
      });
    }
    if (chatRunRegistry.isProcessing(sourceSessionId)) {
      throw new AppError('Wait for the current turn to finish before forking this session.', {
        code: 'SESSION_FORK_IN_PROGRESS',
        statusCode: 409,
      });
    }

    const provider = source.provider as LLMProvider;
    const sessionsProvider = providerRegistry.resolveProvider(provider).sessions;
    if (!sessionsProvider.forkSession) {
      throw new AppError(`Provider "${provider}" does not support session forks.`, {
        code: 'SESSION_FORK_UNSUPPORTED',
        statusCode: 409,
      });
    }

    const fork = await sessionsProvider.forkSession(source.provider_session_id, {
      projectPath: source.project_path ?? undefined,
      model: options.model,
      permissionMode: options.permissionMode,
      lastTurnId: options.lastTurnId,
      title: options.title,
      appendExchange: options.appendExchange,
    });
    const projectPath = fork.projectPath?.trim() || source.project_path?.trim() || '';
    if (!projectPath) {
      throw new AppError('The forked session did not provide a project path.', {
        code: 'SESSION_PROJECT_PATH_MISSING',
        statusCode: 500,
      });
    }

    const sessionId = randomUUID();
    const summary = options.title?.trim()
      || `Fork: ${source.custom_name?.trim() || 'Untitled Codex Session'}`;
    sessionsDb.createAppSession(sessionId, provider, projectPath);
    sessionsDb.assignProviderSessionId(sessionId, fork.providerSessionId);
    sessionsDb.createSession(
      fork.providerSessionId,
      provider,
      projectPath,
      summary,
      undefined,
      undefined,
      fork.jsonlPath,
    );

    return {
      sessionId,
      provider,
      projectPath,
      summary,
    };
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset' | 'before' | 'from' | 'after' | 'around'>
      & { payload?: 'page' | 'full' | 'text' } = {},
  ): Promise<FetchHistoryResult> {
    const anchored = [options.before, options.from, options.after, options.around].some((value) => value !== undefined);
    const { result, identity } = await loadFullHistory(sessionId, anchored);
    if (options.payload === 'text') {
      // Find's index: every searchable record, no paging, tied to the same revision as pages.
      const all = paginateHistory(result, identity, { limit: null });
      const messages: NormalizedMessage[] = [];
      for (const message of all.messages) {
        const copy = findTextHistoryMessage(message);
        if (copy) messages.push({ ...copy, sessionId });
      }
      return { ...all, messages };
    }
    const full = options.payload === 'full';
    const page = paginateHistory(result, identity, options, full ? undefined : {
      bytes: HISTORY_PAGE_BUDGET_BYTES,
      measure: (message) => measureHistoryMessage(message, sessionId),
    });
    return {
      ...page,
      messages: page.messages.map((message) => ({
        ...(full ? message : slimHistoryMessage(message, sessionId)),
        sessionId,
      })),
    };
  },

  /** One complete history record, for details a page omitted. */
  async fetchHistoryMessage(sessionId: string, messageId: string): Promise<NormalizedMessage> {
    const { result } = await loadFullHistory(sessionId, false);
    const message = result.messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      throw new AppError('Message not found in this session.', { code: 'HISTORY_MESSAGE_NOT_FOUND', statusCode: 404 });
    }
    return { ...message, sessionId };
  },

  /** One inline image of a history record, decoded from its stored data URL. */
  async fetchHistoryImage(sessionId: string, messageId: string, index: number): Promise<{ mediaType: string; body: Buffer }> {
    const image = decodeHistoryImage(await this.fetchHistoryMessage(sessionId, messageId), index);
    if (!image) {
      throw new AppError('Image not found in this message.', { code: 'HISTORY_IMAGE_NOT_FOUND', statusCode: 404 });
    }
    return image;
  },

  /**
   * Resolves one session (by app id, falling back to the provider-native id)
   * to its metadata plus the owning project.
   *
   * This backs deep links like `/session/:sessionId`: the frontend's paginated
   * project payloads only carry each project's first session page, so a
   * session opened directly by URL may not be present client-side at all —
   * this lookup is the authoritative way to learn which project owns it.
   */
  getSessionDetailsById(sessionId: string): SessionDetails {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path?.trim() ? session.project_path : null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      summary: session.custom_name?.trim() || '',
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      lastActivity: session.updated_at ?? session.created_at ?? null,
      isArchived: Boolean(session.isArchived),
      project: project && projectPath
        ? {
            projectId: project.project_id,
            path: projectPath,
            fullPath: projectPath,
            displayName: resolveProjectDisplayName(projectPath, project.custom_project_name),
            isStarred: Boolean(project.isStarred),
            isArchived: Boolean(project.isArchived),
          }
        : null,
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk && session.jsonl_path) {
      removedFromDisk = await removeFileIfExists(session.jsonl_path);
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },

  /**
   * Toggles the starred flag on one session. Provider-agnostic: keyed purely on
   * the app session id, so it works for every provider adapter.
   */
  toggleSessionStarById(sessionId: string): { sessionId: string; isStarred: boolean } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const nextIsStarred = !session.isStarred;
    sessionsDb.updateSessionIsStarred(sessionId, nextIsStarred);
    return { sessionId, isStarred: nextIsStarred };
  },

  /**
   * Toggles the session's standing Auto-Continue mode. Turning it on or off
   * clears the firing count, so an earlier run of continues never counts
   * against the next one.
   */
  toggleSessionAutoContinueById(sessionId: string): { sessionId: string; autoContinue: boolean } {
    const current = sessionsDb.getSessionAutoContinue(sessionId);
    if (!current) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const nextAutoContinue = !current.enabled;
    sessionsDb.setSessionAutoContinue(sessionId, nextAutoContinue);
    return { sessionId, autoContinue: nextAutoContinue };
  },
};
