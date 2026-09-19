import { useCallback, useState } from 'react';

import type { TurnStage } from '../stores/useSessionStore';

export interface SessionActivity {
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  /** What the runtime says it is doing; null leaves the label to its own words. */
  stage?: TurnStage | null;
  /** Output tokens the turn has produced so far, when the runtime reports them. */
  outputTokens?: number;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   */
  startedAt: number;
}

export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

export type SessionActivitySnapshot = {
  sessionId: string;
  statusText?: string | null;
  stage?: TurnStage | null;
  canInterrupt?: boolean;
  startedAt?: number;
};

export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: {
    statusText?: string | null;
    stage?: TurnStage | null;
    outputTokens?: number;
    canInterrupt?: boolean;
  },
) => void;

export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => void;

export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
) => void;

const LOCAL_ACTIVITY_GRACE_MS = 10_000;

const turnStagesMatch = (left?: TurnStage | null, right?: TurnStage | null): boolean => (
  left === right
  || (!!left && !!right
    && left.name === right.name
    && left.tokens === right.tokens
    && left.attempt === right.attempt
    && left.maxAttempts === right.maxAttempts
    && left.reason === right.reason)
);

const sessionActivityMapsMatch = (
  left: ReadonlyMap<string, SessionActivity>,
  right: ReadonlyMap<string, SessionActivity>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const [sessionId, leftActivity] of left) {
    const rightActivity = right.get(sessionId);
    if (
      !rightActivity
      || leftActivity.statusText !== rightActivity.statusText
      || !turnStagesMatch(leftActivity.stage, rightActivity.stage)
      || leftActivity.outputTokens !== rightActivity.outputTokens
      || leftActivity.canInterrupt !== rightActivity.canInterrupt
      || leftActivity.startedAt !== rightActivity.startedAt
    ) {
      return false;
    }
  }

  return true;
};

/**
 * Single source of truth for which sessions are actively processing a
 * request. Everything the chat UI shows (activity indicator, abort
 * availability, status text) is derived from this map; terminal events
 * (`complete`, abort, an authoritative idle subscribe ack) delete the entry
 * atomically. Session ids are always concrete (allocated before the first
 * send), so entries are keyed by real session ids only.
 */
export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(
    new Map(),
  );

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, activity) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      const next: SessionActivity = {
        statusText:
          activity?.statusText !== undefined ? activity.statusText : existing?.statusText ?? null,
        stage: activity?.stage !== undefined ? activity.stage : existing?.stage ?? null,
        outputTokens: activity?.outputTokens ?? existing?.outputTokens,
        canInterrupt: activity?.canInterrupt ?? existing?.canInterrupt ?? true,
        startedAt: existing?.startedAt ?? Date.now(),
      };

      if (
        existing
        && existing.statusText === next.statusText
        && turnStagesMatch(existing.stage, next.stage)
        && existing.outputTokens === next.outputTokens
        && existing.canInterrupt === next.canInterrupt
      ) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, next);
      return updated;
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, opts) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      if (!existing) {
        return prev;
      }

      // Guard against stale `chat_subscribed` idle acks: if a new request
      // started after the subscribe was sent, the idle ack describes the
      // older request and must not clear the newer one.
      if (opts?.ifStartedBefore !== undefined && existing.startedAt >= opts.ifStartedBefore) {
        return prev;
      }

      const updated = new Map(prev);
      updated.delete(sessionId);
      return updated;
    });
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((sessions) => {
    const now = Date.now();

    setProcessingSessions((prev) => {
      const incoming = new Map<string, SessionActivitySnapshot>();
      for (const session of sessions) {
        if (!session.sessionId) {
          continue;
        }
        incoming.set(session.sessionId, session);
      }

      const updated = new Map<string, SessionActivity>();

      for (const [sessionId, snapshot] of incoming) {
        const existing = prev.get(sessionId);
        const snapshotStartedAt =
          typeof snapshot.startedAt === 'number' && Number.isFinite(snapshot.startedAt) && snapshot.startedAt > 0
            ? snapshot.startedAt
            : undefined;

        // `startedAt` is client-clock by contract (see SessionActivity). Once this
        // client has witnessed the start, keep its own base — the server snapshot's
        // timestamp is the Pi's clock, and any skew between the two makes
        // `Date.now() - startedAt` in the activity indicator go negative (clamped
        // to a frozen "0s") or jump ahead. The snapshot only seeds entries this
        // client never saw start (page refresh, run started on another device),
        // clamped to `now` so a future-dated start still ticks up from 0.
        updated.set(sessionId, {
          statusText:
            snapshot.statusText !== undefined ? snapshot.statusText : existing?.statusText ?? null,
          stage: snapshot.stage !== undefined ? snapshot.stage : existing?.stage ?? null,
          outputTokens: existing?.outputTokens,
          canInterrupt: snapshot.canInterrupt ?? existing?.canInterrupt ?? true,
          startedAt:
            existing?.startedAt
            ?? (snapshotStartedAt !== undefined ? Math.min(snapshotStartedAt, now) : now),
        });
      }

      for (const [sessionId, activity] of prev) {
        if (!incoming.has(sessionId) && now - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) {
          updated.set(sessionId, activity);
        }
      }

      return sessionActivityMapsMatch(prev, updated) ? prev : updated;
    });
  }, []);

  return {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  };
}
