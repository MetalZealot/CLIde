import fsSync, { type Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import { loadClaudeContextCeiling } from '@/modules/providers/list/claude/claude-context-usage.js';
import {
  normalizeClaudeModelId,
  readClaudeContextWindowOverride,
  resolveClaudeCeilingProvenance,
  resolveClaudeContextCeiling,
  toCeilingProvenanceFields,
} from '@/modules/providers/list/claude/claude-context-window.js';
import { pickSupersedesTranscript } from '@/modules/providers/list/claude/claude-models.provider.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { extractCodexContextTokenUsage } from '@/shared/codex-token-usage.js';
import type { AnyRecord, ProviderSessionActiveModelChange } from '@/shared/types.js';
import { AppError, getOpenCodeDatabasePath } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  getHomeDirectory: () => string;
  getOpenCodeDatabasePath: () => string;
  fileExists: (filePath: string) => boolean;
  readDirectory: (directoryPath: string) => Promise<Dirent[]>;
  readTextFile: (filePath: string) => Promise<string>;
  /** `CONTEXT_WINDOW`, which outranks every derived ceiling when set. */
  readClaudeContextWindowOverride: () => number | undefined;
  readClaudeCeilingProvenance: typeof resolveClaudeCeilingProvenance;
  /** The SDK's own reading for a session, cached per provider-native id. */
  loadClaudeContextCeiling: typeof loadClaudeContextCeiling;
  /** Model-table fallback for history reads and post-restart sessions. */
  resolveClaudeContextCeiling: typeof resolveClaudeContextCeiling;
  /** The active-model sidecar pick, keyed by app session id. */
  getChangedActiveModel: (sessionId: string) => Promise<ProviderSessionActiveModelChange>;
};

type TokenUsageResult = {
  used: number;
  total?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheTokens?: number;
  breakdown: {
    input: number;
    output: number;
  };
  autoCompactThreshold?: number;
  isAutoCompactEnabled?: boolean;
  unsupported?: boolean;
  message?: string;
};

type OpenCodeTokenRow = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

const defaultDependencies: ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  getHomeDirectory: () => os.homedir(),
  getOpenCodeDatabasePath,
  fileExists: (filePath) => fsSync.existsSync(filePath),
  readDirectory: (directoryPath) => fsp.readdir(directoryPath, { withFileTypes: true }),
  readTextFile: (filePath) => fsp.readFile(filePath, 'utf8'),
  readClaudeContextWindowOverride,
  readClaudeCeilingProvenance: resolveClaudeCeilingProvenance,
  loadClaudeContextCeiling,
  resolveClaudeContextCeiling,
  getChangedActiveModel: (sessionId) => providerModelsService.getChangedActiveModel('claude', sessionId),
};

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

async function findCodexSessionFile(
  directoryPath: string,
  providerSessionId: string,
  dependencies: ProviderTokenUsageServiceDependencies,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await dependencies.readDirectory(directoryPath);
  } catch {
    // Codex session folders are date-partitioned and can disappear while a
    // cleanup is running. An unreadable branch is simply not a match.
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findCodexSessionFile(entryPath, providerSessionId, dependencies);
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }

    if (entry.name.includes(providerSessionId) && entry.name.endsWith('.jsonl')) {
      return entryPath;
    }
  }

  return null;
}

function readCodexTokenUsage(fileContent: string): TokenUsageResult {
  let tokenUsage: ReturnType<typeof extractCodexContextTokenUsage> = null;
  let contextWindow = 200_000;
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const tokenInfo = entry.type === 'event_msg' && entry.payload?.type === 'token_count'
        ? entry.payload.info
        : null;
      if (!tokenInfo) {
        continue;
      }

      // Shared with the live Codex stream: `total_token_usage` is cumulative
      // across the thread, so it overstates what is in the context window after
      // a compaction. The helper prefers the per-turn `last_token_usage`.
      tokenUsage = extractCodexContextTokenUsage(tokenInfo);
      if (tokenUsage) {
        contextWindow = tokenUsage.total;
      }
      break;
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }

  return {
    used: tokenUsage?.used || 0,
    total: contextWindow,
    inputTokens: tokenUsage?.inputTokens || 0,
    outputTokens: tokenUsage?.outputTokens || 0,
    breakdown: tokenUsage?.breakdown || { input: 0, output: 0 },
  };
}

type ClaudeTranscriptUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Model named by the last genuine turn, used to pick the context ceiling. */
  model: string | null;
  /** Timestamp of that turn, compared against a stored pick for recency. */
  timestamp: string | undefined;
};

/**
 * Finds the latest assistant message carrying *real* usage data.
 *
 * Mirrors `extractHistoryTokenUsage` in `claude-sessions.provider.ts` and
 * `extractTokenBudget` in the Claude runtime — all three must stay in sync.
 * Claude appends locally-fabricated assistant rows (session-limit notices,
 * API-error placeholders) with an all-zero `usage` object; breaking on those
 * would report used=0 and blank the ring. Rows with no real input, and subagent
 * sidechains (their own smaller context), are skipped.
 */
function readClaudeTranscriptUsage(fileContent: string): ClaudeTranscriptUsage {
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;

      if (entry.isSidechain) {
        continue;
      }

      const usage = entry.type === 'assistant' ? entry.message?.usage : null;
      if (!usage) {
        continue;
      }

      const directInputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
      const cacheReadTokens = readUsageNumber(
        usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens,
      );
      const cacheCreationTokens = readUsageNumber(
        usage.cache_creation_input_tokens
          ?? usage.cacheCreationInputTokens
          ?? usage.cacheCreationTokens,
      );
      const inputTokens = directInputTokens + cacheReadTokens + cacheCreationTokens;

      // Synthetic/placeholder rows report zero input — skip them.
      if (inputTokens <= 0) {
        continue;
      }

      return {
        inputTokens,
        outputTokens: readUsageNumber(usage.output_tokens ?? usage.outputTokens),
        cacheReadTokens,
        cacheCreationTokens,
        model: typeof entry.message?.model === 'string' ? entry.message.model : null,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      };
    } catch {
      // Skip malformed lines without discarding usage from earlier messages.
    }
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    model: null,
    timestamp: undefined,
  };
}

function readOpenCodeTokenUsage(databasePath: string, providerSessionId: string): TokenUsageResult {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const columns = database.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const requiredColumns = [
      'tokens_input',
      'tokens_output',
      'tokens_reasoning',
      'tokens_cache_read',
      'tokens_cache_write',
    ];

    if (!requiredColumns.every((column) => columnNames.has(column))) {
      return {
        used: 0,
        inputTokens: 0,
        outputTokens: 0,
        breakdown: { input: 0, output: 0 },
        unsupported: true,
        message: 'Token usage tracking is not available in this OpenCode database schema',
      };
    }

    const row = database.prepare(`
      SELECT
        tokens_input AS inputTokens,
        tokens_output AS outputTokens,
        tokens_reasoning AS reasoningTokens,
        tokens_cache_read AS cacheReadTokens,
        tokens_cache_write AS cacheWriteTokens
      FROM session
      WHERE id = ?
    `).get(providerSessionId) as OpenCodeTokenRow | undefined;

    if (!row) {
      throw new AppError('OpenCode session was not found.', {
        code: 'OPENCODE_SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const inputTokens = readUsageNumber(row.inputTokens) + readUsageNumber(row.cacheReadTokens);
    const outputTokens = readUsageNumber(row.outputTokens);
    const used = readUsageNumber(row.inputTokens)
      + outputTokens
      + readUsageNumber(row.reasoningTokens)
      + readUsageNumber(row.cacheReadTokens)
      + readUsageNumber(row.cacheWriteTokens);

    return {
      used,
      inputTokens,
      outputTokens,
      breakdown: { input: inputTokens, output: outputTokens },
    };
  } finally {
    database.close();
  }
}

/**
 * Creates the provider token-usage service used by the provider routes. The
 * provider test suite supplies isolated filesystem and session dependencies so
 * every calculator can be exercised without touching a developer's real data.
 */
export function createProviderTokenUsageService(
  dependencyOverrides: Partial<ProviderTokenUsageServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    /**
     * Resolves all provider-specific storage details from one app-facing
     * session id, then returns the latest usage snapshot for that provider.
     */
    async getSessionTokenUsage(sessionId: string): Promise<TokenUsageResult> {
      const session = dependencies.getSessionById(sessionId);
      if (!session) {
        throw new AppError(`Session "${sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }

      const providerSessionId = session.provider_session_id || sessionId;

      if (session.provider === 'cursor') {
        return {
          used: 0,
          total: 0,
          inputTokens: 0,
          outputTokens: 0,
          breakdown: { input: 0, output: 0 },
          unsupported: true,
          message: 'Token usage tracking not available for Cursor sessions',
        };
      }

      if (session.provider === 'opencode') {
        const databasePath = dependencies.getOpenCodeDatabasePath();
        if (!dependencies.fileExists(databasePath)) {
          throw new AppError('OpenCode database was not found.', {
            code: 'OPENCODE_DATABASE_NOT_FOUND',
            statusCode: 404,
          });
        }

        return readOpenCodeTokenUsage(databasePath, providerSessionId);
      }

      if (session.provider === 'codex') {
        const indexedFilePath = session.jsonl_path && dependencies.fileExists(session.jsonl_path)
          ? session.jsonl_path
          : null;
        const sessionFilePath = indexedFilePath ?? await findCodexSessionFile(
          path.join(dependencies.getHomeDirectory(), '.codex', 'sessions'),
          providerSessionId,
          dependencies,
        );

        if (!sessionFilePath) {
          throw new AppError(`Codex session file for "${sessionId}" was not found.`, {
            code: 'CODEX_SESSION_FILE_NOT_FOUND',
            statusCode: 404,
          });
        }

        const fileContent = await dependencies.readTextFile(sessionFilePath);
        return readCodexTokenUsage(fileContent);
      }

      let sessionFilePath = session.jsonl_path;
      if (!sessionFilePath) {
        if (!session.project_path) {
          throw new AppError(`Session file for "${sessionId}" was not found.`, {
            code: 'SESSION_FILE_NOT_FOUND',
            statusCode: 404,
          });
        }

        const encodedProjectPath = session.project_path.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDirectory = path.join(
          dependencies.getHomeDirectory(),
          '.claude',
          'projects',
          encodedProjectPath,
        );
        sessionFilePath = path.join(projectDirectory, `${providerSessionId}.jsonl`);

        const relativePath = path.relative(path.resolve(projectDirectory), path.resolve(sessionFilePath));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          throw new AppError('Resolved session path is invalid.', {
            code: 'INVALID_SESSION_PATH',
            statusCode: 400,
          });
        }
      }

      if (!dependencies.fileExists(sessionFilePath)) {
        throw new AppError(`Session file for "${sessionId}" was not found.`, {
          code: 'SESSION_FILE_NOT_FOUND',
          statusCode: 404,
        });
      }

      const fileContent = await dependencies.readTextFile(sessionFilePath);
      const usage = readClaudeTranscriptUsage(fileContent);

      // The ceiling follows the session's active model. The last real turn names
      // the model that produced the reading above; a pick made since that turn is
      // what the next turn runs, so it wins on the same recency rule
      // `resolveResumeModel` uses. Reusing the scanned row avoids a second pass.
      let ceilingModel = usage.model;
      try {
        const changedModel = await dependencies.getChangedActiveModel(sessionId);
        if (changedModel.supported
          && changedModel.changed
          && changedModel.model?.trim()
          && pickSupersedesTranscript(changedModel.updatedAt, usage.timestamp)) {
          ceilingModel = changedModel.model.trim();
        }
      } catch {
        // No stored pick, or it is unreadable — the transcript model stands.
      }

      // If this session has ever streamed a turn, the SDK already reported its
      // real ceiling and threshold, which beats deriving them (the reading is
      // persisted, so this survives a restart and a resume). Usable only while it
      // still describes the session's model: switching model changes the window,
      // and the cached reading predates the switch.
      const cachedCeiling = await dependencies.loadClaudeContextCeiling(providerSessionId);
      const cachedModelStillApplies = Boolean(cachedCeiling)
        && (!ceilingModel
          || normalizeClaudeModelId(cachedCeiling!.model).id === normalizeClaudeModelId(ceilingModel).id);
      const sdkCeiling = cachedModelStillApplies ? cachedCeiling : null;

      const contextWindow = dependencies.readClaudeContextWindowOverride()
        ?? sdkCeiling?.maxTokens
        ?? dependencies.resolveClaudeContextCeiling({ model: ceilingModel });

      return {
        used: usage.inputTokens + usage.outputTokens,
        total: contextWindow,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheTokens: usage.cacheReadTokens + usage.cacheCreationTokens,
        autoCompactThreshold: sdkCeiling?.autoCompactThreshold,
        isAutoCompactEnabled: sdkCeiling?.isAutoCompactEnabled,
        ...toCeilingProvenanceFields(dependencies.readClaudeCeilingProvenance({ model: ceilingModel })),
        breakdown: { input: usage.inputTokens, output: usage.outputTokens },
      };
    },
  };
}

/**
 * Used by the provider routes to serve token usage from only an app session id.
 */
export const providerTokenUsageService = createProviderTokenUsageService();
