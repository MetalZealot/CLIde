import { serialize } from 'node:v8';

import type { FetchHistoryResult, HistorySourceRevision } from '@/shared/types.js';

type CacheEntry = {
  identity: string;
  source: HistorySourceRevision;
  retainedBytes: number;
  full: FetchHistoryResult;
};

type CacheLoadResult =
  | { stable: true; full: FetchHistoryResult }
  | { stable: false };

type GetFullHistoryArgs = {
  sessionId: string;
  identity: string;
  getRevision: (previous?: HistorySourceRevision) => Promise<HistorySourceRevision | null>;
  loadFull: () => Promise<FetchHistoryResult>;
};

type SessionHistoryCacheOptions = {
  maxRetainedBytes?: number;
  maxEntries?: number;
  maxStableLoadAttempts?: number;
};

const MAX_RETAINED_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
const MAX_STABLE_LOAD_ATTEMPTS = 3;

/**
 * Creates the parsed-history cache used by the sessions service and focused
 * provider tests. Entries are LRU bounded by normalized serialized size, not
 * transcript bytes, and concurrent work is shared only for an exact source
 * revision.
 */
export function createSessionHistoryCache(options: SessionHistoryCacheOptions = {}) {
  const maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_HISTORY_BYTES;
  const maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;
  const maxStableLoadAttempts = options.maxStableLoadAttempts ?? MAX_STABLE_LOAD_ATTEMPTS;
  const entries = new Map<string, CacheEntry>();
  const pendingLoads = new Map<string, Promise<CacheLoadResult>>();
  const activeRequests = new Map<string, { identity: string; users: number }>();

  function removeEntry(sessionId: string): void {
    entries.delete(sessionId);
  }

  function retainedBytes(): number {
    let total = 0;
    for (const entry of entries.values()) {
      total += entry.retainedBytes;
    }
    return total;
  }

  function evictOverBudget(): void {
    let total = retainedBytes();
    for (const [sessionId, entry] of entries) {
      if (total <= maxRetainedBytes && entries.size <= maxEntries) {
        break;
      }
      entries.delete(sessionId);
      total -= entry.retainedBytes;
    }
  }

  return {
    async getFullHistory({
      sessionId,
      identity,
      getRevision,
      loadFull,
    }: GetFullHistoryArgs): Promise<FetchHistoryResult | null> {
      // Identity generations live only while requests can still publish a result.
      let request = activeRequests.get(sessionId);
      if (!request || request.identity !== identity) {
        request = { identity, users: 0 };
        activeRequests.set(sessionId, request);
      }
      request.users += 1;
      try {
        const existing = entries.get(sessionId);
        if (existing && existing.identity !== identity) {
          removeEntry(sessionId);
        }

        for (let attempt = 0; attempt < maxStableLoadAttempts; attempt += 1) {
          const candidate = entries.get(sessionId);
          const previous = candidate?.identity === identity ? candidate.source : undefined;
          const source = await getRevision(previous);
          if (activeRequests.get(sessionId) !== request) return null;
          if (!source) {
            removeEntry(sessionId);
            return null;
          }

          if (candidate && candidate.identity === identity && candidate.source.revision === source.revision) {
            entries.delete(sessionId);
            entries.set(sessionId, candidate);
            return candidate.full;
          }

          removeEntry(sessionId);
          const pendingKey = `${sessionId}\0${identity}\0${source.revision}`;
          let pending = pendingLoads.get(pendingKey);
          if (!pending) {
            pending = (async (): Promise<CacheLoadResult> => {
              const full = await loadFull();
              const after = await getRevision(source);
              if (!after || after.revision !== source.revision) {
                return { stable: false };
              }

              const cost = serialize(full).byteLength;
              if (
                cost <= maxRetainedBytes
                && maxEntries > 0
                && activeRequests.get(sessionId) === request
              ) {
                entries.delete(sessionId);
                entries.set(sessionId, { identity, source: after, retainedBytes: cost, full });
                evictOverBudget();
              }
              return { stable: true, full };
            })();
            pendingLoads.set(pendingKey, pending);
          }

          try {
            const result = await pending;
            if (result.stable) {
              return result.full;
            }
          } finally {
            if (pendingLoads.get(pendingKey) === pending) {
              pendingLoads.delete(pendingKey);
            }
          }
        }

        if (activeRequests.get(sessionId) === request) removeEntry(sessionId);
        return null;
      } finally {
        request.users -= 1;
        if (request.users === 0 && activeRequests.get(sessionId) === request) {
          activeRequests.delete(sessionId);
        }
      }
    },

    clear(): void {
      entries.clear();
      pendingLoads.clear();
      activeRequests.clear();
    },

    stats(): { entries: number; retainedBytes: number; pendingLoads: number } {
      return { entries: entries.size, retainedBytes: retainedBytes(), pendingLoads: pendingLoads.size };
    },
  };
}

/** Shared process cache consumed by the provider sessions service. */
export const sessionHistoryCache = createSessionHistoryCache();
