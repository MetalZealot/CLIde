import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from '../hooks/useChatMessages';
import type { ChatMessage } from '../types/types';

import {
  formatFollowUpQuestions,
  formatUsageLimitText,
  normalizeInlineCodeFences,
  parseInteractivePrompt,
} from './chatFormatting';

/** Authored conversation text: what Find searches and prompt navigation walks. */
export function isChatFindConversationMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    return true;
  }

  return message.type === 'assistant'
    && !message.isToolUse
    && !message.isThinking
    && !message.isCompactSummary
    && !message.isCompactBoundary
    && !message.isSystemNotice
    && !message.isTaskNotification
    && !message.isLocalCommandStdout;
}

/** One searchable message; each segment is one `data-chat-find-content` element's text. */
export type ChatFindEntry = {
  messageId: string;
  recordId: string;
  segments: string[];
  isPrompt: boolean;
};

export type ChatFindMatch = {
  entry: number;
  messageId: string;
  recordId: string;
  /** Position among this message's matches, in display order. */
  ordinal: number;
};

// Parse-time extensions only: the renderer's remark-breaks turns "\n" into
// <br>, which reads the same as the "\n" left in text here.
const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false });

type MdNode = { type: string; value?: string; lang?: string | null; children?: MdNode[] };

// Containers whose children render as separate blocks, which the DOM separates with "\n".
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'footnoteDefinition']);

function mdText(node: MdNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
    case 'math':
    case 'html':
      return node.value ?? '';
    case 'break':
      return '\n';
    case 'code': {
      // The code block shows its language label above the code.
      const label = /^\w+/.exec(node.lang ?? '')?.[0];
      return label && label !== 'text' ? `${label}\n${node.value ?? ''}` : node.value ?? '';
    }
    case 'image':
    case 'imageReference':
    case 'definition':
    case 'footnoteReference':
      return '';
    default:
      return (node.children ?? []).map(mdText).join(BLOCK_CONTAINERS.has(node.type) ? '\n' : '');
  }
}

/** The text a Markdown body displays, without syntax, blocks separated by "\n". */
export function markdownDisplayText(content: string): string {
  return mdText(markdownParser.parse(normalizeInlineCodeFences(content)) as MdNode);
}

function assistantBodyText(content: string): string {
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // Not JSON; rendered as Markdown below.
    }
  }
  return markdownDisplayText(content);
}

const segmentCache = new WeakMap<ChatMessage, string[]>();

/** Mirrors what MessageComponent marks searchable, in display order. */
export function chatFindSegments(message: ChatMessage): string[] {
  const cached = segmentCache.get(message);
  if (cached) return cached;
  let segments: string[] = [];
  if (isChatFindConversationMessage(message)) {
    const content = String(message.content || '');
    if (message.type === 'user') {
      segments = content.trim() ? [markdownDisplayText(content)] : [];
    } else if (message.isInteractivePrompt) {
      const { questionLine, options } = parseInteractivePrompt(content);
      segments = [questionLine, ...options.map((option) => option.text)];
    } else {
      const formatted = formatUsageLimitText(content);
      const followUp = formatFollowUpQuestions(message.followUpQuestions);
      const body = followUp && formatted.trim() === followUp.trim() ? '' : formatted;
      segments = [
        ...(body ? [assistantBodyText(body)] : []),
        ...(message.followUpQuestions ?? []).flatMap(({ question, options }) => [question, ...options]),
      ];
    }
  }
  segmentCache.set(message, segments);
  return segments;
}

/** Record kinds that can display as conversation text; converting others alone would change their display. */
export function isSearchableRecord(record: NormalizedMessage): boolean {
  return record.kind === 'text'
    || record.kind === 'interactive_prompt'
    || record.kind === 'stream_delta'
    || (record.kind === 'tool_result' && !record.toolId);
}

/**
 * Whole-history search records with the loaded window laid over them: loaded
 * copies replace their snapshot twins, and records the snapshot lacks (live
 * rows, newer turns) keep their place beside the nearest record both share.
 */
export function mergeFindRecords(snapshot: NormalizedMessage[] | null, loaded: NormalizedMessage[]): NormalizedMessage[] {
  const searchable = loaded.filter(isSearchableRecord);
  if (!snapshot) return searchable;
  const position = new Map(snapshot.map((record, index) => [record.id, index]));
  const replaced = new Map<string, NormalizedMessage>();
  const before = new Map<number, NormalizedMessage[]>();
  const after = new Map<number, NormalizedMessage[]>();
  let anchor: number | null = null;
  let pending: NormalizedMessage[] = [];
  for (const record of searchable) {
    const index = position.get(record.id);
    if (index === undefined) {
      if (anchor === null) pending.push(record);
      else after.set(anchor, [...(after.get(anchor) ?? []), record]);
      continue;
    }
    replaced.set(record.id, record);
    if (anchor === null && pending.length > 0) {
      before.set(index, pending);
      pending = [];
    }
    anchor = index;
  }
  const merged: NormalizedMessage[] = [];
  snapshot.forEach((record, index) => {
    merged.push(...(before.get(index) ?? []), replaced.get(record.id) ?? record, ...(after.get(index) ?? []));
  });
  return [...merged, ...pending];
}

/** Converts one record the same way the chat does, so display objects (and their segments) are shared. */
export function chatFindEntriesForRecord(record: NormalizedMessage): ChatFindEntry[] {
  const entries: ChatFindEntry[] = [];
  for (const message of normalizedToChatMessages([record])) {
    if (!message.id) continue;
    const segments = chatFindSegments(message);
    if (segments.length === 0) continue;
    entries.push({ messageId: message.id, recordId: record.id, segments, isPrompt: message.type === 'user' });
  }
  return entries;
}

/** Literal, case-insensitive matches in display order; never joins text across segments. */
export function searchChatFindEntries(entries: ChatFindEntry[], query: string): ChatFindMatch[] {
  if (!query) return [];
  const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: ChatFindMatch[] = [];
  entries.forEach((entry, index) => {
    let ordinal = 0;
    for (const segment of entry.segments) {
      matcher.lastIndex = 0;
      while (matcher.exec(segment)) {
        matches.push({ entry: index, messageId: entry.messageId, recordId: entry.recordId, ordinal });
        ordinal += 1;
      }
    }
  });
  return matches;
}

/** Authored prompts in conversation order, for prompt navigation. */
export function listPromptTurns(entries: ChatFindEntry[]): ChatFindEntry[] {
  return entries.filter((entry) => entry.isPrompt);
}

/**
 * The prompt before (-1) or after (1) a message; from null, the newest (-1)
 * or oldest (1). A message that is not itself a prompt steps from its position.
 */
export function adjacentPromptTurn(
  entries: ChatFindEntry[],
  fromMessageId: string | null,
  direction: 1 | -1,
): ChatFindEntry | null {
  const from = fromMessageId === null ? -1 : entries.findIndex((entry) => entry.messageId === fromMessageId);
  if (fromMessageId !== null && from < 0) return null;
  if (direction === 1) {
    for (let index = from + 1; index < entries.length; index += 1) if (entries[index].isPrompt) return entries[index];
    return null;
  }
  for (let index = (from < 0 ? entries.length : from) - 1; index >= 0; index -= 1) if (entries[index].isPrompt) return entries[index];
  return null;
}

/**
 * The record a sidebar search result points at: the first whose text holds
 * the snippet's opening phrase, else the one nearest its timestamp.
 */
export function locateSearchTarget(
  records: NormalizedMessage[],
  target: { snippet?: string; timestamp?: string },
): NormalizedMessage | null {
  const candidates = records.filter(isSearchableRecord);
  const flatten = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
  if (target.snippet) {
    const phrase = flatten(target.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '')).trim().slice(0, 80).trim();
    if (phrase.length >= 10) {
      const hit = candidates.find((record) => flatten(record.content ?? '').includes(phrase));
      if (hit) return hit;
    }
  }
  const time = target.timestamp ? new Date(target.timestamp).getTime() : NaN;
  if (Number.isNaN(time)) return null;
  let nearest: NormalizedMessage | null = null;
  let distance = Infinity;
  for (const record of candidates) {
    const gap = Math.abs(new Date(record.timestamp).getTime() - time);
    if (gap < distance) {
      distance = gap;
      nearest = record;
    }
  }
  return nearest;
}
