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
  state: 'pending' | 'sent' | 'cancelled' | 'failed';
  failureReason: string | null;
  createdAt: string;
  firedAt: string | null;
  /** Stored descriptors, so an edit can put the files back in the composer. */
  attachments?: { path: string; name?: string; mimeType?: string; size?: number }[];
};

/** An edit this client has open; the server holds the message while it lasts. */
export type ScheduledMessageEdit = {
  id: string;
  token: string;
  trigger: ScheduledMessageTrigger;
  scheduledFor: string | null;
};

/** Why an open edit ended without saving; `sentAt` is set when the message went out. */
export type ScheduledEditLoss = {
  reason: 'sent' | 'failed' | 'cancelled' | 'taken';
  sentAt: Date | null;
};

const readEditLoss = async (response: Response): Promise<ScheduledEditLoss> => {
  const body = await response.json().catch(() => null) as { reason?: string; firedAt?: string | null } | null;
  const reason = body?.reason === 'sent' || body?.reason === 'failed' || body?.reason === 'taken'
    ? body.reason
    : 'cancelled';
  const sentAt = body?.firedAt ? new Date(body.firedAt) : null;
  return { reason, sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null };
};

/** A third of the server's 90s hold, so one lost renewal cannot end it. */
const HOLD_RENEW_MS = 30_000;

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
type ScheduledSendEvent = {
  kind?: string;
  sessionId?: string;
  scheduledMessageId?: string;
  content?: unknown;
  attachments?: unknown;
  timestamp?: unknown;
};

export function useScheduledMessages(
  sessionId: string | null,
  subscribe?: (listener: (event: ScheduledSendEvent) => void) => () => void,
  /**
   * Draws the bubble the composer never drew, since nobody typed this turn.
   * `sentAt` is when the message actually went out, not when this client heard
   * about it — a phone that was asleep hears about it late.
   */
  onSent?: (content: string, sentAt: Date, attachments: NonNullable<ScheduledMessage['attachments']>) => void,
  /** The open edit's message sent, was cancelled, or was opened elsewhere; the edit has ended. */
  onEditLost?: (loss: ScheduledEditLoss) => void,
) {
  const [pending, setPending] = useState<ScheduledMessage[]>([]);
  const [editing, setEditing] = useState<ScheduledMessageEdit | null>(null);
  // Written wherever `editing` is, never synced from it on render: an edit is
  // tracked here before it opens, and a render in between must not drop it.
  const editingRef = useRef<ScheduledMessageEdit | null>(null);

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
        const parsedSentAt = typeof event.timestamp === 'string' ? new Date(event.timestamp) : new Date();
        const sentAt = Number.isNaN(parsedSentAt.getTime()) ? new Date() : parsedSentAt;
        onSent?.(
          String(event.content ?? ''),
          sentAt,
          Array.isArray(event.attachments) ? event.attachments : [],
        );
        if (event.scheduledMessageId && event.scheduledMessageId === editingRef.current?.id) {
          editingRef.current = null;
          setEditing(null);
          onEditLost?.({ reason: 'sent', sentAt });
        }
        void refresh();
      }
    });
  }, [onEditLost, onSent, refresh, sessionId, subscribe]);

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

  const releaseEdit = useCallback((edit: ScheduledMessageEdit | null) => {
    if (!edit) return;
    void api.releaseScheduledMessageHold(edit.id, edit.token).catch(() => {
      // The hold lapses on its own; a failed release only delays the message.
    });
  }, []);

  // Leaving the session or the page ends the edit. Anything that stops the
  // renewals without reaching here — a sleeping phone, a closed tab — lets the
  // hold lapse instead, and the message sends as if never opened.
  useEffect(() => () => {
    releaseEdit(editingRef.current);
    editingRef.current = null;
    setEditing(null);
  }, [releaseEdit, sessionId]);

  useEffect(() => {
    if (!editing) return;
    // A refused renewal means the hold is gone for good — typically a phone that
    // slept past it while the message sent — so the edit on screen is stale.
    const renew = () => {
      // Out of view counts as gone, whether or not the browser keeps timers running.
      if (document.visibilityState === 'hidden') return;
      void api.renewScheduledMessageHold(editing.id, editing.token).then(async (response) => {
        if (response.status !== 409 || editingRef.current !== editing) return;
        const loss = await readEditLoss(response);
        if (editingRef.current !== editing) return;
        editingRef.current = null;
        setEditing(null);
        onEditLost?.(loss);
        void refresh();
      }).catch(() => {});
    };
    const interval = window.setInterval(renew, HOLD_RENEW_MS);
    // Timers stall while a phone sleeps; renew the moment it is looked at again.
    const onVisible = () => { if (document.visibilityState === 'visible') renew(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [editing, onEditLost, refresh]);

  /**
   * Holds a message for editing and returns its latest stored copy, or null
   * when it already sent. Opening a second edit ends the first.
   *
   * The edit is not live until `open()`: the caller fetches what it needs
   * first, then opens it in the same tick it fills the composer, so no send
   * can land between the two. `open()` is false if another edit or a session
   * change superseded this one meanwhile.
   */
  const holdForEdit = useCallback(async (
    message: ScheduledMessage,
  ): Promise<{ message: ScheduledMessage; open: () => boolean } | null> => {
    releaseEdit(editingRef.current);
    editingRef.current = null;
    setEditing(null);
    try {
      const response = await api.holdScheduledMessage(message.id);
      if (!response.ok) {
        void refresh();
        return null;
      }
      const body = await response.json() as { token: string; message: ScheduledMessage };
      const edit: ScheduledMessageEdit = {
        id: message.id,
        token: body.token,
        trigger: body.message.trigger,
        scheduledFor: body.message.scheduledFor,
      };
      // Tracked before it opens, so a session change meanwhile still releases it.
      editingRef.current = edit;
      return {
        message: body.message,
        open: () => {
          if (editingRef.current !== edit) return false;
          setEditing(edit);
          return true;
        },
      };
    } catch {
      return null;
    }
  }, [refresh, releaseEdit]);

  /**
   * Saves the open edit; the message keeps its trigger. A refusal ends the
   * edit and reports why through `onEditLost`; an unreachable server leaves it
   * open to retry, since the hold is still running.
   */
  const saveEdit = useCallback(async (
    content: string,
    options: Record<string, unknown>,
  ): Promise<'saved' | 'lost' | 'unreachable'> => {
    const edit = editingRef.current;
    if (!edit) return 'lost';
    let response: Response;
    try {
      response = await api.saveScheduledMessageEdit(edit.id, { token: edit.token, content, options });
    } catch {
      return 'unreachable';
    }
    if (editingRef.current === edit) {
      editingRef.current = null;
      setEditing(null);
    }
    if (response.ok) {
      void refresh();
      return 'saved';
    }
    if (response.status !== 409) {
      editingRef.current = edit;
      setEditing(edit);
      return 'unreachable';
    }
    onEditLost?.(await readEditLoss(response));
    void refresh();
    return 'lost';
  }, [onEditLost, refresh]);

  const cancel = useCallback(async (id: string): Promise<void> => {
    if (editingRef.current?.id === id) {
      editingRef.current = null;
      setEditing(null);
    }
    // Drop it locally first: the row is already claimed server-side either way,
    // and leaving a cancelled card on screen reads as a failure.
    setPending((current) => current.filter((message) => message.id !== id));
    try {
      await api.cancelScheduledMessage(id);
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { pending, schedule, cancel, refresh, editing, holdForEdit, saveEdit };
}
