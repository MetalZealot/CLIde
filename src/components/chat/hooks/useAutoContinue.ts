import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { ChatMessage } from '../types/types';

/**
 * How far back a limit stop is still the end of the conversation. A stop is
 * the last thing that happened or it is history; scanning the whole transcript
 * would resurrect an offer from weeks ago.
 */
const LOOKBACK = 12;

/**
 * The limit notice that can offer Auto-Continue, or null: the turn
 * ended on a usage limit that lifts on its own and the user has not moved on
 * since.
 *
 * The stop is recognised by the provider's own classification, carried on the
 * message as `usageLimit` — never by the notice's wording, which is localized
 * prose that has already changed shape once.
 */
export function resolveLiveLimitStop(
  messages: ChatMessage[],
  canScheduleOnUsageReset: boolean,
  nowMs: number = Date.now(),
): ChatMessage | null {
  if (!canScheduleOnUsageReset) return null;

  for (const message of messages.slice(-LOOKBACK).reverse()) {
    // Typing again is the user moving on; anything before that is history.
    if (message.type === 'user') return null;

    const stop = message.usageLimit;
    if (!stop) continue;
    // A spent balance never lifts, so waiting on it would be a lie.
    if (!stop.resumes) return null;
    // A passed reset means the conversation is simply old.
    if (stop.resetsAt && Date.parse(stop.resetsAt) <= nowMs) return null;
    return message;
  }

  return null;
}

export function useLiveLimitStop(
  messages: ChatMessage[],
  canScheduleOnUsageReset: boolean,
): ChatMessage | null {
  return useMemo(
    () => resolveLiveLimitStop(messages, canScheduleOnUsageReset),
    [canScheduleOnUsageReset, messages],
  );
}

// The mode as last set on this device. The session list only catches up on its
// next fetch, and the limit line and the header menu must never disagree.
const overrides = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function setAutoContinueOverride(sessionId: string, enabled: boolean): void {
  overrides.set(sessionId, enabled);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * One session's standing Auto-Continue mode, shared by every control that
 * shows it. Setting it moves at once and settles on what the server stored.
 */
export function useSessionAutoContinue(
  sessionId: string | null | undefined,
  projects: Project[],
  fallback: boolean | undefined,
) {
  const override = useSyncExternalStore(subscribe, () => (sessionId ? overrides.get(sessionId) : undefined));
  const stored = useMemo(() => {
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === sessionId);
      if (match) return match.autoContinue;
    }
    return undefined;
  }, [projects, sessionId]);
  const enabled = override ?? Boolean(stored ?? fallback);

  const setEnabled = useCallback((next: boolean, limitStopLive: boolean) => {
    if (!sessionId) return;
    setAutoContinueOverride(sessionId, next);
    void api.setSessionAutoContinue(sessionId, next, limitStopLive)
      .then((response: Response) => (response.ok ? response.json() : null))
      .then((payload: { enabled?: boolean } | null) => {
        setAutoContinueOverride(sessionId, typeof payload?.enabled === 'boolean' ? payload.enabled : !next);
      })
      .catch(() => setAutoContinueOverride(sessionId, !next));
  }, [sessionId]);

  return useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);
}
