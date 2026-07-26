import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { isCodexAppServerChatEnabled } from '@/modules/providers/list/codex/codex-chat-transport-state.js';
import { toImageAttachments } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, sliceTailPage } from '@/shared/utils.js';
import { extractCodexContextTokenUsage } from '@/shared/codex-token-usage.js';

const PROVIDER = 'codex';

type CodexHistoryResult =
  | AnyRecord[]
  | {
      messages?: AnyRecord[];
      total?: number;
      hasMore?: boolean;
      offset?: number;
      limit?: number | null;
      tokenUsage?: unknown;
    };

function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

/**
 * Reads the image attachments Codex records on `user_message` events.
 * Turns sent with `local_image` input items land in `local_images` as file
 * paths (verified against real rollout JSONL); the `images` array can carry
 * base64 data URLs, which are passed through as inline `data` attachments so
 * the UI can preview them without a file lookup.
 *
 * Exported for tests.
 */
export function extractCodexUserImages(
  payload: AnyRecord | null | undefined,
): Array<{ path?: string; data?: string }> | undefined {
  if (!payload) {
    return undefined;
  }

  const candidates = [
    ...(Array.isArray(payload.local_images) ? payload.local_images : []),
    ...(Array.isArray(payload.images) ? payload.images : []),
  ];

  const attachments: Array<{ path?: string; data?: string }> = [];
  for (const entry of candidates) {
    if (typeof entry !== 'string' || !entry.trim()) {
      continue;
    }
    if (entry.startsWith('data:')) {
      attachments.push({ data: entry });
    } else {
      attachments.push(...toImageAttachments([entry]));
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

function extractCodexTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

type CodexPersistedQuestion = {
  id: string;
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  allowOther?: boolean;
  isSecret?: boolean;
  multiSelect?: boolean;
};

function parseJsonRecord(value: unknown): AnyRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as AnyRecord;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as AnyRecord
      : null;
  } catch {
    return null;
  }
}

export function normalizePersistedCodexQuestions(value: unknown): CodexPersistedQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((rawQuestion) => {
    const question = readObjectRecord(rawQuestion);
    const id = typeof question?.id === 'string' ? question.id.trim() : '';
    const prompt = typeof question?.question === 'string' ? question.question.trim() : '';
    if (!question || !id || !prompt || seen.has(id)) {
      return [];
    }
    seen.add(id);

    const options = Array.isArray(question.options)
      ? question.options.flatMap((rawOption: unknown) => {
          const option = readObjectRecord(rawOption);
          const label = typeof option?.label === 'string' ? option.label.trim() : '';
          return label
            ? [{
                label,
                ...(typeof option?.description === 'string'
                  ? { description: option.description }
                  : {}),
              }]
            : [];
        })
      : [];

    return [{
      id,
      header: typeof question.header === 'string' ? question.header : undefined,
      question: prompt,
      options,
      allowOther: Boolean(question.isOther ?? question.allowOther),
      isSecret: Boolean(question.isSecret),
      // App Server questions have no multi-select marker.
      multiSelect: false,
    }];
  });
}

export function normalizeAndRedactCodexQuestionAnswers(
  value: unknown,
  secretQuestionIds: Set<string>,
): Record<string, string[]> {
  const record = parseJsonRecord(value);
  const candidate = readObjectRecord(record?.answers) ?? record;
  if (!candidate) {
    return {};
  }

  const answers: Record<string, string[]> = {};
  for (const [questionId, rawAnswer] of Object.entries(candidate)) {
    const nested = readObjectRecord(rawAnswer);
    const values = Array.isArray(nested?.answers)
      ? nested.answers
      : Array.isArray(rawAnswer)
        ? rawAnswer
        : typeof rawAnswer === 'string'
          ? [rawAnswer]
          : [];
    const normalized = values.filter((answer): answer is string => typeof answer === 'string');
    answers[questionId] = secretQuestionIds.has(questionId) && normalized.length > 0
      ? ['[redacted]']
      : normalized;
  }
  return answers;
}

async function getCodexSessionMessages(
  sessionId: string,
  limit: number | null = null,
  offset = 0,
): Promise<CodexHistoryResult> {
  try {
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages: AnyRecord[] = [];
    const requestUserInputByCallId = new Map<string, {
      questions: CodexPersistedQuestion[];
      secretQuestionIds: Set<string>;
    }>();
    let tokenUsage: AnyRecord | null = null;
    let pendingTurnId: string | null = null;
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;

        if (
          (entry.type === 'turn_context' || entry.type === 'event_msg')
          && typeof entry.payload?.turn_id === 'string'
        ) {
          pendingTurnId = entry.payload.turn_id;
        }

        if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
          const info = entry.payload.info as AnyRecord;
          tokenUsage = extractCodexContextTokenUsage(info) as AnyRecord | null;
        }

        if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload as AnyRecord)) {
          messages.push({
            type: 'user',
            uuid: pendingTurnId || undefined,
            timestamp: entry.timestamp,
            message: {
              role: 'user',
              content: entry.payload.message,
            },
            images: extractCodexUserImages(entry.payload as AnyRecord),
          });
          pendingTurnId = null;
        }

        if (
          entry.type === 'response_item' &&
          entry.payload?.type === 'message' &&
          entry.payload.role === 'assistant'
        ) {
          const textContent = extractCodexTextContent(entry.payload.content);
          if (textContent.trim()) {
            messages.push({
              type: 'assistant',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: textContent,
              },
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
          const summaryText = Array.isArray(entry.payload.summary)
            ? entry.payload.summary
                .map((item: AnyRecord) => item?.text)
                .filter(Boolean)
                .join('\n')
            : '';

          if (summaryText.trim()) {
            messages.push({
              type: 'thinking',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: summaryText,
              },
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
          let toolName = entry.payload.name;
          let toolInput = entry.payload.arguments;

          if (toolName === 'request_user_input') {
            const parsedInput = parseJsonRecord(entry.payload.arguments) ?? {};
            const questions = normalizePersistedCodexQuestions(parsedInput.questions);
            toolInput = {
              ...parsedInput,
              questions,
            };
            if (typeof entry.payload.call_id === 'string') {
              requestUserInputByCallId.set(entry.payload.call_id, {
                questions,
                secretQuestionIds: new Set(
                  questions.filter((question) => question.isSecret).map((question) => question.id),
                ),
              });
            }
          } else if (toolName === 'shell_command') {
            toolName = 'Bash';
            try {
              const args = JSON.parse(entry.payload.arguments) as AnyRecord;
              toolInput = JSON.stringify({ command: args.command });
            } catch {
              // Keep original arguments when parsing fails.
            }
          }

          messages.push({
            type: 'tool_use',
            timestamp: entry.timestamp,
            toolName,
            toolInput,
            toolCallId: entry.payload.call_id,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
          const requestUserInput = typeof entry.payload.call_id === 'string'
            ? requestUserInputByCallId.get(entry.payload.call_id)
            : null;
          if (requestUserInput) {
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: 'Your questions have been answered.',
              toolUseResult: {
                answers: normalizeAndRedactCodexQuestionAnswers(
                  entry.payload.output,
                  requestUserInput.secretQuestionIds,
                ),
              },
            });
            continue;
          }

          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
          const toolName = entry.payload.name || 'custom_tool';
          const input = entry.payload.input || '';

          if (toolName === 'apply_patch') {
            const fileMatch = String(input).match(/\*\*\* Update File: (.+)/);
            const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';
            const lines = String(input).split('\n');
            const oldLines: string[] = [];
            const newLines: string[] = [];

            for (const lineContent of lines) {
              if (lineContent.startsWith('-') && !lineContent.startsWith('---')) {
                oldLines.push(lineContent.slice(1));
              } else if (lineContent.startsWith('+') && !lineContent.startsWith('+++')) {
                newLines.push(lineContent.slice(1));
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'Edit',
              toolInput: JSON.stringify({
                file_path: filePath,
                old_string: oldLines.join('\n'),
                new_string: newLines.join('\n'),
              }),
              toolCallId: entry.payload.call_id,
            });
          } else {
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName,
              toolInput: input,
              toolCallId: entry.payload.call_id,
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output || '',
          });
        }
      } catch {
        // Skip malformed lines.
      }
    }

    messages.sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
    );
    const total = messages.length;

    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage,
      };
    }

    return { messages, tokenUsage };
  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

export class CodexSessionsProvider implements IProviderSessions {
  async forkSession(
    providerSessionId: string,
    options: {
      projectPath?: string;
      model?: string;
      permissionMode?: string;
      lastTurnId?: string;
    } = {},
  ): Promise<{
    providerSessionId: string;
    projectPath?: string;
    jsonlPath?: string | null;
  }> {
    if (!isCodexAppServerChatEnabled()) {
      throw new Error('Codex session forking requires the App Server chat transport.');
    }

    // Keep the history/indexing adapter free of an eager transport dependency:
    // the transport resolves provider model services, which in turn load the
    // provider registry containing this class.
    const { forkCodexAppServerThread } = await import(
      '@/modules/providers/list/codex/codex-app-server-chat.transport.js'
    );
    const thread = await forkCodexAppServerThread(providerSessionId, {
      cwd: options.projectPath,
      model: options.model,
      permissionMode: options.permissionMode,
      lastTurnId: options.lastTurnId,
    });

    return {
      providerSessionId: thread.id,
      projectPath: thread.cwd || options.projectPath,
      jsonlPath: thread.path,
    };
  }

  /**
   * Normalizes a persisted Codex JSONL entry.
   *
   * Live Codex SDK events are transformed before they reach normalizeMessage(),
   * while history entries already use a compact message/tool shape from projects.js.
   */
  private normalizeHistoryEntry(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'thinking' || raw.isReasoning) {
      const thinkingContent = typeof raw.message?.content === 'string'
        ? raw.message.content
        : '';
      if (!thinkingContent.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: thinkingContent,
      })];
    }

    if (raw.message?.role === 'user') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : String(raw.message.content || '');
      const rawImages = Array.isArray(raw.images) && raw.images.length > 0 ? raw.images : undefined;
      if (!content.trim() && !rawImages) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content,
        images: rawImages,
      })];
    }

    if (raw.message?.role === 'assistant') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
      })];
    }

    if (raw.type === 'tool_use' || raw.toolName) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName || 'Unknown',
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
      })];
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: Boolean(raw.isError),
        toolUseResult: raw.toolUseResult,
      })];
    }

    return [];
  }

  /**
   * Normalizes either a Codex history entry or a transformed live SDK event.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    if (raw.message?.role) {
      return this.normalizeHistoryEntry(raw, sessionId);
    }

    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'item') {
      switch (raw.itemType) {
        case 'agent_message':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: raw.message?.content || '',
          })];
        case 'reasoning':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'thinking',
            content: raw.message?.content || '',
          })];
        case 'command_execution':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'Bash',
            toolInput: { command: raw.command },
            toolId: baseId,
            output: raw.output,
            exitCode: raw.exitCode,
            status: raw.status,
          })];
        case 'file_change':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'FileChanges',
            toolInput: raw.changes,
            toolId: baseId,
            status: raw.status,
          })];
        case 'mcp_tool_call':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: raw.tool || 'MCP',
            toolInput: raw.arguments,
            toolId: baseId,
            server: raw.server,
            result: raw.result,
            error: raw.error,
            status: raw.status,
          })];
        case 'web_search':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'WebSearch',
            toolInput: { query: raw.query },
            toolId: baseId,
          })];
        case 'todo_list':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'TodoList',
            toolInput: { items: raw.items },
            toolId: baseId,
          })];
        case 'error':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'error',
            content: raw.message?.content || 'Unknown error',
          })];
        default:
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: raw.itemType || 'Unknown',
            toolInput: raw.item || raw,
            toolId: baseId,
          })];
      }
    }

    if (raw.type === 'turn_complete') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'complete',
      })];
    }
    if (raw.type === 'turn_failed') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'error',
        content: raw.error?.message || 'Turn failed',
      })];
    }

    return [];
  }

  /**
   * Loads Codex JSONL history and keeps token usage metadata when projects.js
   * provides it.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let result: CodexHistoryResult;
    try {
      // Load full history first so `total` reflects frontend-normalized messages,
      // not raw JSONL records.
      result = await getCodexSessionMessages(sessionId, null, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CodexProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    const tokenUsage = Array.isArray(result) ? undefined : result.tokenUsage;

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawMessages) {
      normalized.push(...this.normalizeHistoryEntry(raw, sessionId));
    }

    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = {
            content: toolResult.content,
            isError: toolResult.isError,
            toolUseResult: toolResult.toolUseResult,
          };
        }
      }
    }

    let total = 0;
    for (const msg of normalized) {
      if (msg.kind !== 'tool_result') {
        total += 1;
      }
    }
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage,
    };
  }
}
