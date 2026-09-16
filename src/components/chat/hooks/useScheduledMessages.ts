import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

export type ScheduledMessageTrigger = 'time' | 'usage-reset';

export type ScheduledMessage = {
  id: string;
  sessionId: string;
  provider: string;
  content: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor: string | null;
  state: 'pending' | 'paused' | 'sent' | 'cancelled' | 'failed';
  failureReason: string | null;
  createdAt: string;
  firedAt: string | null;
  /** Stored descriptors, so an edit can put the files back in the composer. */
  attachments?: { path: string; name?: string; mimeType?: string; size?: number }[];
};

/** The message this client is editing. Paused server-side, so it cannot send meanwhile. */
export type ScheduledMessageEdit = {
  id: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor: string | null;
};

/** What a save came back as: the message was cancelled elsewhere, or the server never answered. */
export type ScheduledEditOutcome = 'saved' | 'gone' | 'unreachable';

type CreateInput = {
  content: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor?: string | null;
  options?: Record<string, unknown>;
};

type ScheduledSendEvent = {
  kind?: string;
  sessionId?: string;
  content?: unknown;
  attachments?: unknown;
  timestamp?: unknown;
};

/**
 * The messages one session has waiting, and the edit this client has open.
 *
 * Both unsent states are surfaced: 'pending' is waiting for its moment,
 * 'paused' is open for editing and will not send until it is saved or
 * resumed. Settled rows are not — they are already in the transcript.
 */
export function useScheduledMessages(
  sessionId: string | null,
  subscribe?: (listener: (event: ScheduledSendEvent) => void) => () => void,
  /**
   * Draws the bubble the composer never drew, since nobody typed this turn.
   * `sentAt` is when the message actually went out, not when this client heard
   * about it — a phone that was asleep hears about it late.
   */
  onSent?: (content: string, sentAt: Date, attachments: NonNullable<ScheduledMessage['attachments']>) => void,
) {
  const [unsent, setUnsent] = useState<ScheduledMessage[]>([]);
  const [editing, setEditing] = useState<ScheduledMessageEdit | null>(null);
  // Written wherever `editing` is, never synced from it on render: an edit is
  // tracked here before it opens, and a render in between must not drop it.
  const editingRef = useRef<ScheduledMessageEdit | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setUnsent([]);
      return;
    }
    try {
      const response = await api.scheduledMessages(sessionId);
      if (!response.ok) return;
      const body = await response.json() as { messages?: ScheduledMessage[] };
      setUnsent((body.messages ?? []).filter(
        (message) => message.state === 'pending' || message.state === 'paused',
      ));
    } catch {
      // A composer that cannot reach the list still has to send messages.
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // A message that fires stops being unsent, and nothing else would tell the
  // card above the composer to go.
  useEffect(() => {
    if (!subscribe || !sessionId) return;
    return subscribe((event) => {
      if (event.kind === 'scheduled_message_sent' && event.sessionId === sessionId) {
        const parsed = typeof event.timestamp === 'string' ? new Date(event.timestamp) : new Date();
        onSent?.(
          String(event.content ?? ''),
          Number.isNaN(parsed.getTime()) ? new Date() : parsed,
          Array.isArray(event.attachments) ? event.attachments : [],
        );
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

  // An open edit belongs to the session it was opened in; leaving drops it here
  // while the message stays paused server-side, listed as paused until resumed.
  useEffect(() => () => {
    editingRef.current = null;
    setEditing(null);
  }, [sessionId]);

  /**
   * Pauses a message and returns its stored copy, or null when it is already
   * gone. The edit is not live until `open()`: the caller loads the composer
   * first, then opens it in the same tick, so no send can land between the two.
   */
  const beginEdit = useCallback(async (
    message: ScheduledMessage,
  ): Promise<{ message: ScheduledMessage; open: () => boolean } | null> => {
    try {
      const response = await api.pauseScheduledMessage(message.id);
      if (!response.ok) {
        void refresh();
        return null;
      }
      const body = await response.json() as { message: ScheduledMessage };
      const edit: ScheduledMessageEdit = {
        id: message.id,
        trigger: body.message.trigger,
        scheduledFor: body.message.scheduledFor,
      };
      void refresh();
      return {
        message: body.message,
        open: () => {
          editingRef.current = edit;
          setEditing(edit);
          return true;
        },
      };
    } catch {
      return null;
    }
  }, [refresh]);

  /** Puts a paused message back on its schedule, with no changes. */
  const resume = useCallback(async (id: string): Promise<void> => {
    if (editingRef.current?.id === id) {
      editingRef.current = null;
      setEditing(null);
    }
    try {
      await api.resumeScheduledMessage(id);
    } finally {
      await refresh();
    }
  }, [refresh]);

  /**
   * Saves the open edit and puts the message back on its schedule. 'gone'
   * means it was cancelled elsewhere; 'unreachable' leaves the edit open,
   * since the message is still paused and safe to retry.
   */
  const saveEdit = useCallback(async (
    content: string,
    options: Record<string, unknown>,
  ): Promise<ScheduledEditOutcome> => {
    const edit = editingRef.current;
    if (!edit) return 'gone';
    let response: Response;
    try {
      response = await api.saveScheduledMessageEdit(edit.id, { content, options });
    } catch {
      return 'unreachable';
    }
    if (!response.ok && response.status !== 409) {
      return 'unreachable';
    }
    if (editingRef.current === edit) {
      editingRef.current = null;
      setEditing(null);
    }
    void refresh();
    return response.ok ? 'saved' : 'gone';
  }, [refresh]);

  const cancel = useCallback(async (id: string): Promise<void> => {
    if (editingRef.current?.id === id) {
      editingRef.current = null;
      setEditing(null);
    }
    // Drop it locally first: the row is already claimed server-side either way,
    // and leaving a cancelled card on screen reads as a failure.
    setUnsent((current) => current.filter((message) => message.id !== id));
    try {
      await api.cancelScheduledMessage(id);
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { pending: unsent, schedule, cancel, refresh, editing, beginEdit, resume, saveEdit };
}
