import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';

export type ScheduledMessageTrigger = 'time' | 'usage-reset';

export type ScheduledMessage = {
  id: string;
  sessionId: string;
  provider: string;
  content: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor: string | null;
  state: 'pending' | 'sent' | 'cancelled' | 'failed';
  failureReason: string | null;
  createdAt: string;
  firedAt: string | null;
};

type CreateInput = {
  content: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor?: string | null;
  options?: Record<string, unknown>;
};

/**
 * The messages one session has waiting.
 *
 * Only pending rows are surfaced: a settled one has already become a real
 * message in the transcript, so showing it above the composer would say the
 * same thing twice.
 */
type ScheduledSendEvent = { kind?: string; sessionId?: string; content?: unknown; timestamp?: unknown };

export function useScheduledMessages(
  sessionId: string | null,
  subscribe?: (listener: (event: ScheduledSendEvent) => void) => () => void,
  /**
   * Draws the bubble the composer never drew, since nobody typed this turn.
   * `sentAt` is when the message actually went out, not when this client heard
   * about it — a phone that was asleep hears about it late.
   */
  onSent?: (content: string, sentAt: Date) => void,
) {
  const [pending, setPending] = useState<ScheduledMessage[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setPending([]);
      return;
    }
    try {
      const response = await api.scheduledMessages(sessionId);
      if (!response.ok) return;
      const body = await response.json() as { messages?: ScheduledMessage[] };
      setPending((body.messages ?? []).filter((message) => message.state === 'pending'));
    } catch {
      // A composer that cannot reach the list still has to send messages.
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // A message that fires stops being pending, and nothing else would tell the
  // card above the composer to go.
  useEffect(() => {
    if (!subscribe || !sessionId) return;
    return subscribe((event) => {
      if (event.kind === 'scheduled_message_sent' && event.sessionId === sessionId) {
        const sentAt = typeof event.timestamp === 'string' ? new Date(event.timestamp) : new Date();
        onSent?.(String(event.content ?? ''), Number.isNaN(sentAt.getTime()) ? new Date() : sentAt);
        void refresh();
      }
    });
  }, [onSent, refresh, sessionId, subscribe]);

  /**
   * `intoSessionId` covers the first message in a chat: the session is created
   * as the message is scheduled, so the id arrives before this hook re-renders
   * with it.
   */
  const schedule = useCallback(async (input: CreateInput, intoSessionId?: string): Promise<boolean> => {
    const target = intoSessionId ?? sessionId;
    if (!target) return false;
    const response = await api.createScheduledMessage({ sessionId: target, ...input });
    if (!response.ok) return false;
    await refresh();
    return true;
  }, [refresh, sessionId]);

  const cancel = useCallback(async (id: string): Promise<void> => {
    // Drop it locally first: the row is already claimed server-side either way,
    // and leaving a cancelled card on screen reads as a failure.
    setPending((current) => current.filter((message) => message.id !== id));
    try {
      await api.cancelScheduledMessage(id);
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { pending, schedule, cancel, refresh };
}
