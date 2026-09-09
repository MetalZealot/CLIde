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
export function useScheduledMessages(sessionId: string | null) {
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

  const schedule = useCallback(async (input: CreateInput): Promise<boolean> => {
    if (!sessionId) return false;
    const response = await api.createScheduledMessage({ sessionId, ...input });
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
