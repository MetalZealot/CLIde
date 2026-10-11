/**
 * What each running session is doing besides its own turn — agents still at
 * work and how far its plan has got — as the running-sessions poll reports it.
 * Kept apart from the activity map, which every live event rewrites.
 */
import { useSyncExternalStore } from 'react';

export type RunningWork = {
  agents: number;
  plan: { done: number; total: number } | null;
};

let work = new Map<string, RunningWork>();
const listeners = new Set<() => void>();

const sameWork = (a: RunningWork | undefined, b: RunningWork | undefined): boolean => (
  a?.agents === b?.agents && a?.plan?.done === b?.plan?.done && a?.plan?.total === b?.plan?.total
);

/** Replaces the whole map; sessions the poll no longer lists have stopped. */
export function setRunningWork(next: Map<string, RunningWork>): void {
  const changed = next.size !== work.size || [...next].some(([id, entry]) => !sameWork(entry, work.get(id)));
  if (!changed) return;
  // Unchanged entries keep their identity so their rows skip a render.
  work = new Map([...next].map(([id, entry]) => [id, sameWork(entry, work.get(id)) ? work.get(id) as RunningWork : entry]));
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useRunningWork(sessionId: string | null | undefined): RunningWork | undefined {
  return useSyncExternalStore(subscribe, () => (sessionId ? work.get(sessionId) : undefined));
}
