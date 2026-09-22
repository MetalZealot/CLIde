import { useCallback, useEffect, useState } from 'react';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import { chatFindEntriesForRecord, mergeFindRecords, type ChatFindEntry } from '../utils/chatFindIndex';

/** Main-thread slice per build step; long histories yield between slices. */
const BUILD_SLICE_MS = 12;
/** Streaming changes the loaded records many times a second; rebuilds coalesce. */
const REBUILD_DELAY_MS = 100;

const sameEntries = (a: ChatFindEntry[], b: ChatFindEntry[]) => a.length === b.length
  && a.every((entry, index) => entry.messageId === b[index].messageId && entry.segments === b[index].segments);

type UseChatTextIndexArgs = {
  sessionStore: SessionStore;
  sessionId: string | null;
  enabled: boolean;
  /** The store's loaded window, including live rows. */
  loadedRecords: NormalizedMessage[];
};

export type ChatTextIndex = {
  /** Searchable messages of the whole conversation in display order; null until built. */
  entries: ChatFindEntry[] | null;
  isPreparing: boolean;
  loadFailed: boolean;
  retry: () => void;
};

/**
 * The whole conversation's authored text without rendering it. A complete
 * loaded history is indexed as is; otherwise the server's text-only copy is
 * fetched (reused per history revision) with the loaded window laid over it.
 */
export function useChatTextIndex({ sessionStore, sessionId, enabled, loadedRecords }: UseChatTextIndexArgs): ChatTextIndex {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; records: NormalizedMessage[] | null } | null>(null);
  const [entries, setEntries] = useState<{ sessionId: string; entries: ChatFindEntry[] } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const slot = sessionId ? sessionStore.getSessionSlot(sessionId) : undefined;
  const complete = Boolean(slot && !slot.hasMore && !slot.hasNewer);
  const revision = slot?.revision ?? null;

  useEffect(() => {
    if (!enabled || !sessionId) {
      setSnapshot(null);
      setEntries(null);
      setLoadFailed(false);
      return undefined;
    }
    if (complete) {
      setSnapshot({ sessionId, records: null });
      return undefined;
    }
    const controller = new AbortController();
    setLoadFailed(false);
    sessionStore.fetchFindText(sessionId, controller.signal).then(
      (records) => {
        if (!controller.signal.aborted) setSnapshot({ sessionId, records });
      },
      () => {
        if (!controller.signal.aborted) setLoadFailed(true);
      },
    );
    return () => controller.abort();
  }, [attempt, complete, enabled, revision, sessionId, sessionStore]);

  useEffect(() => {
    if (!enabled || !sessionId || !snapshot || snapshot.sessionId !== sessionId) return undefined;
    const records = mergeFindRecords(snapshot.records, loadedRecords);
    const built: ChatFindEntry[] = [];
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const deadline = performance.now() + BUILD_SLICE_MS;
      while (next < records.length && performance.now() < deadline) {
        built.push(...chatFindEntriesForRecord(records[next]));
        next += 1;
      }
      if (next < records.length) {
        timer = setTimeout(step, 0);
        return;
      }
      // Unchanged text keeps its identity, so a rebuild with nothing new never re-searches.
      setEntries((previous) => (previous?.sessionId === sessionId && sameEntries(previous.entries, built)
        ? previous
        : { sessionId, entries: built }));
    };
    timer = setTimeout(step, entries?.sessionId === sessionId ? REBUILD_DELAY_MS : 0);
    return () => clearTimeout(timer);
    // `entries` only picks the first delay; a rebuild must not retrigger itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadedRecords, sessionId, snapshot]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = enabled && entries?.sessionId === sessionId ? entries.entries : null;
  return { entries: current, isPreparing: enabled && current === null && !loadFailed, loadFailed, retry };
}
