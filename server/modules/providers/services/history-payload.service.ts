import type { NormalizedMessage } from '@/shared/types.js';

/** Strings above this many characters leave history pages; the message detail route serves them. */
export const ELIDE_THRESHOLD_CHARS = 8 * 1024;
/** Leading characters kept in place of an elided string, for collapsed summaries. */
export const PREVIEW_CHARS = 1024;
/** Serialized page target; a single record larger than this still gets a page of its own. */
export const HISTORY_PAGE_BUDGET_BYTES = 256 * 1024;

const MAX_DEPTH = 6;

/** Marks a record whose page copy omits content; `bytes` is the omitted record's full serialized size. */
export type ElidedDetail = { bytes: number; resultLines?: number };

type SlimState = { changed: boolean };

function slimString(value: string, state: SlimState): string {
  if (value.length <= ELIDE_THRESHOLD_CHARS) return value;
  state.changed = true;
  return value.slice(0, PREVIEW_CHARS);
}

function slimValue(value: unknown, state: SlimState, depth = 0): unknown {
  if (typeof value === 'string') return slimString(value, state);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) {
    if (JSON.stringify(value).length <= ELIDE_THRESHOLD_CHARS) return value;
    state.changed = true;
    return null;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => slimValue(item, state, depth + 1));
    let size = 2;
    for (let index = 0; index < items.length; index += 1) {
      size += JSON.stringify(items[index] ?? null).length + 1;
      if (size > ELIDE_THRESHOLD_CHARS) {
        state.changed = true;
        return items.slice(0, index);
      }
    }
    return items;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = slimValue(entry, state, depth + 1);
  }
  return result;
}

function slimToolResult(toolResult: unknown, state: SlimState): unknown {
  if (!toolResult || typeof toolResult !== 'object') return toolResult;
  const record = toolResult as Record<string, unknown>;
  return {
    ...record,
    content: typeof record.content === 'string' ? slimString(record.content, state) : slimValue(record.content, state),
    toolUseResult: slimValue(record.toolUseResult, state),
  };
}

function countLines(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.split('\n').length : 0;
}

/** URL of one inline image served by the message image route. */
export function historyImageUrl(sessionId: string, messageId: string, index: number): string {
  return `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/images/${index}`;
}

const slimmed = new WeakMap<NormalizedMessage, { sessionId: string; message: NormalizedMessage }>();

/**
 * The page copy of one history record: inline image bodies become URLs and
 * oversized tool payloads become previews flagged with `elidedDetail`.
 * Authored prose is never shortened. Never mutates the (cached) source record.
 */
export function slimHistoryMessage(message: NormalizedMessage, sessionId: string): NormalizedMessage {
  const cached = slimmed.get(message);
  if (cached && cached.sessionId === sessionId) return cached.message;

  const state: SlimState = { changed: false };
  let imagesChanged = false;
  const next: NormalizedMessage = { ...message };

  if (Array.isArray(message.images)) {
    next.images = message.images.map((image, index) => {
      if (!image || typeof image !== 'object' || typeof (image as { data?: unknown }).data !== 'string') return image;
      const { data, ...rest } = image as { data: string };
      imagesChanged = true;
      const mediaType = /^data:([^;,]+)/.exec(data)?.[1];
      return { ...rest, url: historyImageUrl(sessionId, message.id, index), ...(mediaType ? { mediaType } : {}) };
    });
  }

  if (message.kind === 'tool_use' || message.kind === 'tool_result') {
    if (message.toolInput !== undefined) next.toolInput = slimValue(message.toolInput, state);
    if (message.toolResult !== undefined) next.toolResult = slimToolResult(message.toolResult, state) as NormalizedMessage['toolResult'];
    if (message.toolUseResult !== undefined) next.toolUseResult = slimValue(message.toolUseResult, state);
    if (Array.isArray(message.subagentTools)) {
      next.subagentTools = message.subagentTools.map((tool) => {
        if (!tool || typeof tool !== 'object') return tool;
        const child = tool as Record<string, unknown>;
        return {
          ...child,
          toolInput: slimValue(child.toolInput, state),
          ...(child.toolResult !== undefined ? { toolResult: slimToolResult(child.toolResult, state) } : {}),
        };
      });
    }
    if (message.kind === 'tool_result' && typeof message.content === 'string') {
      next.content = slimString(message.content, state);
    }
  }

  let result: NormalizedMessage = message;
  if (state.changed) {
    const detail: ElidedDetail = { bytes: Buffer.byteLength(JSON.stringify(message)) };
    const resultLines = countLines(message.toolResult?.content ?? (message.kind === 'tool_result' ? message.content : undefined));
    if (resultLines !== undefined) detail.resultLines = resultLines;
    next.elidedDetail = detail;
    result = next;
  } else if (imagesChanged) {
    result = { ...message, images: next.images };
  }
  slimmed.set(message, { sessionId, message: result });
  return result;
}

const TEXT_FIELDS = [
  'id', 'sessionId', 'provider', 'kind', 'role', 'content', 'timestamp', 'displayText', 'commandName',
  'commandMessage', 'commandArgs', 'isLocalCommand', 'isLocalCommandStdout', 'isCompactSummary',
  'isSystemNotice', 'followUpQuestions', 'usageLimit', 'isError',
] as const satisfies ReadonlyArray<keyof NormalizedMessage>;

const textCopies = new WeakMap<NormalizedMessage, NormalizedMessage | null>();

/**
 * The search copy of a record: only kinds that can display as conversation
 * text, with only the fields display conversion reads for them. Null otherwise.
 */
export function findTextHistoryMessage(message: NormalizedMessage): NormalizedMessage | null {
  const cached = textCopies.get(message);
  if (cached !== undefined) return cached;
  const searchable = message.kind === 'text'
    || message.kind === 'interactive_prompt'
    || (message.kind === 'tool_result' && !message.toolId);
  const hasText = Boolean(message.content?.trim()) || Boolean(message.followUpQuestions?.length);
  let copy: NormalizedMessage | null = null;
  if (searchable && hasText) {
    const fields: Partial<Record<keyof NormalizedMessage, unknown>> = {};
    for (const key of TEXT_FIELDS) {
      if (message[key] !== undefined) fields[key] = message[key];
    }
    copy = fields as NormalizedMessage;
    // Pages show a standalone result's preview, so search matches the preview too.
    if (message.kind === 'tool_result' && message.content) copy.content = slimString(message.content, { changed: false });
  }
  textCopies.set(message, copy);
  return copy;
}

/** Serialized size of a record's page copy, used to hold pages to the byte budget. */
export function measureHistoryMessage(message: NormalizedMessage, sessionId: string): number {
  return Buffer.byteLength(JSON.stringify({ ...slimHistoryMessage(message, sessionId), sessionId }));
}

/** Decodes one inline image of a full record, or null when it is absent or not a base64 data URL. */
export function decodeHistoryImage(message: NormalizedMessage, index: number): { mediaType: string; body: Buffer } | null {
  const image = Array.isArray(message.images) ? message.images[index] : undefined;
  const data = image && typeof image === 'object' ? (image as { data?: unknown }).data : undefined;
  if (typeof data !== 'string') return null;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(data);
  if (!match || !/^image\//.test(match[1])) return null;
  return { mediaType: match[1], body: Buffer.from(match[2], 'base64') };
}
