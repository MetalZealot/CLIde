import { createHash } from 'node:crypto';

import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { AppError, findTurnStartedAt, sliceTailPage } from '@/shared/utils.js';

// Weak ownership keeps fingerprints within the parsed history's lifetime.
const fingerprints = new WeakMap<NormalizedMessage[], Map<number, string>>();
const MAX_FINGERPRINTS = 8;
/** The history cache reserves bounded fingerprint-map storage per retained snapshot. */
export const HISTORY_FINGERPRINT_BUDGET_BYTES = 2048;

function prefixHash(messages: NormalizedMessage[], count: number): string | undefined {
  if (count > messages.length) return undefined;
  let cached = fingerprints.get(messages);
  const existing = cached?.get(count);
  if (existing) return existing;
  const hash = createHash('sha256');
  for (let index = 0; index < count; index += 1) {
    hash.update(JSON.stringify(messages[index])).update('\n');
  }
  const result = hash.digest('base64url');
  if (!cached) {
    cached = new Map();
    fingerprints.set(messages, cached);
  }
  if (cached.size >= MAX_FINGERPRINTS) cached.delete(cached.keys().next().value!);
  cached.set(count, result);
  return result;
}

type Bookmark = { v: 1; scope: string; count: number; end: number; hash: string };
/** Anchored by record id, so a live tail changing does not invalidate forward paging. */
type NewerToken = { v: 1; scope: string; after: string; end: number };

/** Records in a detached window when the caller gives no limit. */
export const DETACHED_WINDOW_RECORDS = 40;

const encode = (value: Bookmark | NewerToken) => Buffer.from(JSON.stringify(value)).toString('base64url');
const invalidCursor = () => new AppError('Invalid history bookmark.', { code: 'INVALID_HISTORY_CURSOR', statusCode: 400 });
const changedHistory = () => new AppError('History changed. Reload the current window.', {
  code: 'HISTORY_CURSOR_INVALIDATED', statusCode: 409,
});

function decode(encoded: string): Record<string, unknown> {
  try {
    if (encoded.length > 1024 || !/^[\w-]+$/.test(encoded)) throw new Error();
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
}

function readBookmark(encoded: string): Bookmark {
  const value = decode(encoded);
  if (value?.v !== 1 || typeof value.scope !== 'string' || typeof value.hash !== 'string'
    || !Number.isSafeInteger(value.count) || !Number.isSafeInteger(value.end)
    || (value.end as number) < 0 || (value.count as number) < (value.end as number)) throw invalidCursor();
  return value as Bookmark;
}

function readNewerToken(encoded: string): NewerToken {
  const value = decode(encoded);
  if (value?.v !== 1 || typeof value.scope !== 'string' || typeof value.after !== 'string'
    || !Number.isSafeInteger(value.end) || (value.end as number) < 1) throw invalidCursor();
  return value as NewerToken;
}

/** Holds a bounded page to a serialized-byte target; the newest record always stays. */
export type PageBudget = { bytes: number; measure: (message: NormalizedMessage) => number };

/** The sessions service pages every provider after normalization and tool/result joins. */
export function paginateHistory(
  full: FetchHistoryResult,
  identity: string,
  options: Pick<FetchHistoryOptions, 'limit' | 'offset' | 'before' | 'from' | 'after' | 'around'>,
  budget?: PageBudget,
): FetchHistoryResult {
  const limit = options.limit ?? null;
  const offset = options.offset ?? 0;
  const anchors = [options.before, options.from, options.after, options.around].filter((value) => value !== undefined).length;
  if ((limit !== null && (!Number.isSafeInteger(limit) || limit < 0))
    || !Number.isSafeInteger(offset) || offset < 0
    || anchors > 1 || (anchors === 1 && offset !== 0)) {
    throw new AppError('Invalid history pagination options.', { code: 'INVALID_QUERY_PARAMETER', statusCode: 400 });
  }
  const scope = createHash('sha256').update(identity).digest('base64url');
  if (options.around !== undefined || options.after !== undefined) {
    return paginateDetached(full, scope, options, limit, budget);
  }
  const encoded = options.before ?? options.from;
  const bookmark = encoded === undefined ? null : readBookmark(encoded);
  if (bookmark && (bookmark.scope !== scope || prefixHash(full.messages, bookmark.count) !== bookmark.hash)) {
    throw changedHistory();
  }

  const end = bookmark && options.before !== undefined ? bookmark.end : full.messages.length;
  const pageOffset = options.before !== undefined ? full.messages.length - end : offset;
  const sliced = sliceTailPage(full.messages, limit, pageOffset);
  const pageEnd = sliced.start + sliced.page.length;
  let tailStart = sliced.start;
  // A refresh must reach the loaded window, so only bounded pages are held to the budget.
  if (budget && limit !== null && options.from === undefined) {
    let size = 0;
    for (let index = pageEnd - 1; index >= sliced.start; index -= 1) {
      size += budget.measure(full.messages[index]);
      if (size > budget.bytes && index < pageEnd - 1) {
        tailStart = index + 1;
        break;
      }
    }
  }
  const start = options.from !== undefined && bookmark ? bookmark.end : tailStart;
  const messages = options.from !== undefined ? full.messages.slice(start) : full.messages.slice(tailStart, pageEnd);
  // A refresh advances the snapshot; an older-page walk stays on its original snapshot.
  const count = options.before !== undefined && bookmark ? bookmark.count : full.messages.length;
  const nextCursor = start > 0 && limit !== 0
    ? encode({ v: 1, scope, count, end: start, hash: prefixHash(full.messages, count)! })
    : null;
  return {
    ...full,
    messages,
    offset: pageOffset,
    limit,
    hasMore: nextCursor !== null,
    nextCursor,
    revision: `${scope}.${prefixHash(full.messages, full.messages.length)}`,
    recordTotal: full.messages.length,
    turnStartedAt: findTurnStartedAt(full.messages, start),
  };
}

/**
 * A window that need not reach the tail: centred on one record (`around`), or
 * the records after a window's newest one (`after`). Older pages from either
 * use the ordinary `before` bookmark.
 */
function paginateDetached(
  full: FetchHistoryResult,
  scope: string,
  options: Pick<FetchHistoryOptions, 'after' | 'around'>,
  limit: number | null,
  budget?: PageBudget,
): FetchHistoryResult {
  const { messages } = full;
  let start: number;
  let end: number;
  if (options.around !== undefined) {
    const target = messages.findIndex((message) => message.id === options.around);
    if (target < 0) {
      throw new AppError('Message not found in this session.', { code: 'HISTORY_MESSAGE_NOT_FOUND', statusCode: 404 });
    }
    const size = Math.max(1, limit ?? DETACHED_WINDOW_RECORDS);
    end = Math.min(messages.length, Math.max(0, target - Math.floor(size / 2)) + size);
    start = Math.max(0, end - size);
    if (budget) {
      let bytes = 0;
      for (let index = start; index < end; index += 1) bytes += budget.measure(messages[index]);
      // Trim the side farther from the target; the target itself always stays.
      while (bytes > budget.bytes && end - start > 1) {
        if (end - 1 > target && end - 1 - target >= target - start) bytes -= budget.measure(messages[--end]);
        else bytes -= budget.measure(messages[start++]);
      }
    }
  } else {
    const token = readNewerToken(options.after!);
    if (token.scope !== scope) throw changedHistory();
    const anchor = messages[token.end - 1]?.id === token.after
      ? token.end - 1
      : messages.findIndex((message) => message.id === token.after);
    if (anchor < 0) throw changedHistory();
    start = anchor + 1;
    end = limit === null ? messages.length : Math.min(messages.length, start + limit);
    if (budget && limit !== null) {
      let bytes = 0;
      for (let index = start; index < end; index += 1) {
        bytes += budget.measure(messages[index]);
        if (bytes > budget.bytes && index > start) {
          end = index;
          break;
        }
      }
    }
  }

  const count = messages.length;
  const hash = prefixHash(messages, count)!;
  const nextCursor = start > 0 ? encode({ v: 1, scope, count, end: start, hash }) : null;
  const newerCursor = end < count ? encode({ v: 1, scope, after: messages[end - 1].id, end }) : null;
  return {
    ...full,
    messages: messages.slice(start, end),
    offset: count - end,
    limit,
    hasMore: nextCursor !== null,
    nextCursor,
    hasNewer: newerCursor !== null,
    newerCursor,
    revision: `${scope}.${hash}`,
    recordTotal: count,
    turnStartedAt: findTurnStartedAt(messages, start),
  };
}
