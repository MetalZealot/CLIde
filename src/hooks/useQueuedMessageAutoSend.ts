import { useEffect, useRef } from 'react';

import { clearQueuedMessage, readQueuedMessage } from '../components/chat/utils/chatStorage';
import { deliverNow, mintRequestId } from '../stores/sendOutbox';

import { isTurnRunning, type MarkSessionProcessing, type SessionActivityMap } from './useSessionProtection';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  /**
   * The session currently open in the chat view. Its queued draft is owned by
   * the composer (which also handles file attachments and slash commands),
   * so this hook never touches it.
   */
  activeSessionId: string | null;
  ws: WebSocket | null;
  markSessionProcessing: MarkSessionProcessing;
}

/**
 * Dispatches queued messages for sessions the user is NOT currently viewing.
 *
 * The composer persists each queued draft (text + send options snapshotted at
 * queue time) under `queued_message_<sessionId>`. When a session's run leaves
 * the processing map — its previous response completed — this hook sends that
 * session's queued message immediately instead of waiting for the user to
 * open the session again. Removing the storage key before sending is the
 * claim that keeps the composer's own flush from double-sending.
 */
export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const prevProcessingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const prev = prevProcessingRef.current;
    // A session held only by background work takes sends; its queue goes now.
    const current = new Set([...processingSessions].filter(([, activity]) => isTurnRunning(activity)).map(([id]) => id));
    prevProcessingRef.current = current;

    for (const sessionId of prev) {
      if (current.has(sessionId) || sessionId === activeSessionId) {
        continue;
      }

      const queued = readQueuedMessage(sessionId);
      if (!queued) {
        continue;
      }

      // A closed socket would drop the send silently; keep the draft so the
      // composer (or a later completion) can retry once we're connected.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      clearQueuedMessage(sessionId);
      deliverNow({
        type: 'chat.send',
        sessionId,
        requestId: mintRequestId(),
        content: queued.content,
        options: { ...(queued.options ?? {}), attachments: queued.attachments ?? queued.images ?? [] },
      }, null);
      markSessionProcessing(sessionId, { statusText: null, stage: null, canInterrupt: true });
    }
  }, [processingSessions, activeSessionId, ws, markSessionProcessing]);
}
