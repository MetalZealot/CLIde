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

function readBookmark(encoded: string): Bookmark {
  try {
    if (encoded.length > 1024 || !/^[\w-]+$/.test(encoded)) throw new Error();
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (value?.v !== 1 || typeof value.scope !== 'string' || typeof value.hash !== 'string'
      || !Number.isSafeInteger(value.count) || !Number.isSafeInteger(value.end)
      || value.end < 0 || value.count < value.end) throw new Error();
    return value;
  } catch {
    throw new AppError('Invalid history bookmark.', { code: 'INVALID_HISTORY_CURSOR', statusCode: 400 });
  }
}

/** The sessions service pages every provider after normalization and tool/result joins. */
export function paginateHistory(
  full: FetchHistoryResult,
  identity: string,
  options: Pick<FetchHistoryOptions, 'limit' | 'offset' | 'before' | 'from'>,
): FetchHistoryResult {
  const limit = options.limit ?? null;
  const offset = options.offset ?? 0;
  if ((limit !== null && (!Number.isSafeInteger(limit) || limit < 0))
    || !Number.isSafeInteger(offset) || offset < 0
    || (options.before !== undefined && options.from !== undefined)
    || ((options.before !== undefined || options.from !== undefined) && offset !== 0)) {
    throw new AppError('Invalid history pagination options.', { code: 'INVALID_QUERY_PARAMETER', statusCode: 400 });
  }
  const scope = createHash('sha256').update(identity).digest('base64url');
  const encoded = options.before ?? options.from;
  const bookmark = encoded === undefined ? null : readBookmark(encoded);
  if (bookmark && (bookmark.scope !== scope || prefixHash(full.messages, bookmark.count) !== bookmark.hash)) {
    throw new AppError('History changed. Reload the current window.', {
      code: 'HISTORY_CURSOR_INVALIDATED', statusCode: 409,
    });
  }

  const end = bookmark && options.before !== undefined ? bookmark.end : full.messages.length;
  const pageOffset = options.before !== undefined ? full.messages.length - end : offset;
  const sliced = sliceTailPage(full.messages, limit, pageOffset);
  const start = options.from !== undefined && bookmark ? bookmark.end : sliced.start;
  const messages = options.from !== undefined ? full.messages.slice(start) : sliced.page;
  // A refresh advances the snapshot; an older-page walk stays on its original snapshot.
  const count = options.before !== undefined && bookmark ? bookmark.count : full.messages.length;
  const nextCursor = start > 0 && limit !== 0
    ? Buffer.from(JSON.stringify({ v: 1, scope, count, end: start, hash: prefixHash(full.messages, count) })).toString('base64url')
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
