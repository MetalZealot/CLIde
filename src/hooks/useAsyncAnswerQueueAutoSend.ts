import { useEffect } from 'react';

import {
  listAsyncAnswerQueueSessionIds,
  notifyAsyncAnswerDispatched,
  readQueuedAsyncAnswers,
  removeQueuedAsyncAnswer,
} from '../components/chat/utils/asyncQuestionState';
import { readQueuedMessage } from '../components/chat/utils/chatStorage';
import { api } from '../utils/api';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';

type RunningSessionsPayload = {
  data?: { sessions?: Array<{ sessionId?: unknown }> };
};

type UseAsyncAnswerQueueAutoSendArgs = {
  processingSessions: SessionActivityMap;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  markSessionProcessing: MarkSessionProcessing;
};

/** Releases one persisted async-question answer whenever its session is idle. */
export function useAsyncAnswerQueueAutoSend({
  processingSessions,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseAsyncAnswerQueueAutoSendArgs) {
  useEffect(() => {
    let cancelled = false;
    let checking = false;

    const flushOne = async () => {
      if (checking || cancelled || !ws || ws.readyState !== WebSocket.OPEN) return;
      const candidates = listAsyncAnswerQueueSessionIds().filter(
        (sessionId) => !processingSessions.has(sessionId) && !readQueuedMessage(sessionId),
      );
      if (candidates.length === 0) return;

      checking = true;
      try {
        // The activity map is briefly empty during page boot. The gateway is
        // authoritative, so reload cannot release an answer into a live turn.
        const response = await api.runningSessions();
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as RunningSessionsPayload;
        const serverRunning = new Set(
          (Array.isArray(payload.data?.sessions) ? payload.data.sessions : [])
            .map((item) => typeof item.sessionId === 'string' ? item.sessionId : '')
            .filter(Boolean),
        );

        for (const sessionId of candidates) {
          if (cancelled || serverRunning.has(sessionId) || readQueuedMessage(sessionId)) continue;
          const answer = readQueuedAsyncAnswers(sessionId)[0];
          if (!answer) continue;
          const sent = sendMessage({
            type: 'chat.send',
            sessionId,
            content: answer.content,
            options: answer.options ?? {},
          });
          if (!sent) return;

          removeQueuedAsyncAnswer(sessionId, answer.id);
          notifyAsyncAnswerDispatched(sessionId, answer.provider, answer.content);
          markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
          return;
        }
      } catch {
        // Keep the durable FIFO untouched; the next interval retries.
      } finally {
        checking = false;
      }
    };

    const initialTimer = window.setTimeout(() => void flushOne(), 750);
    const retryTimer = window.setInterval(() => void flushOne(), 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(retryTimer);
    };
  }, [markSessionProcessing, processingSessions, sendMessage, ws]);
}
