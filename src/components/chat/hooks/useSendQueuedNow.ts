import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { SessionStore } from '../../../stores/useSessionStore';
import type { LLMProvider } from '../../../types/app';

import type { QueuedDraft } from './useChatComposerState';

const STEER_ACK_TIMEOUT_MS = 15_000;

type PendingSend = {
  sessionId: string;
  provider: LLMProvider;
  draft: QueuedDraft;
  timeoutId: number;
};

type UseSendQueuedNowArgs = {
  sessionId: string | null;
  provider: LLMProvider;
  queuedDraft: QueuedDraft | null;
  canSteer: boolean;
  isProcessing: boolean;
  sendMessage: (message: unknown) => boolean;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  sessionStore: SessionStore;
  deleteQueuedDraft: () => void;
  requeueQueuedDraft: (sessionId: string, draft: QueuedDraft) => void;
  returnDraftToInput: (content: string) => void;
};

/**
 * *Send now*: delivers the queued draft into the running turn over `chat.steer`.
 * The draft leaves the queue while in flight so the end-of-turn flush cannot
 * also send it; a refusal puts it back, an unconfirmed send returns it to the input.
 */
export function useSendQueuedNow({
  sessionId,
  provider,
  queuedDraft,
  canSteer,
  isProcessing,
  sendMessage,
  subscribe,
  sessionStore,
  deleteQueuedDraft,
  requeueQueuedDraft,
  returnDraftToInput,
}: UseSendQueuedNowArgs) {
  const [sendingContent, setSendingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Map<string, PendingSend>());
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;

  useEffect(() => {
    setSendingContent(null);
    setError(null);
  }, [sessionId]);

  // A new queued message replaces the old reason.
  useEffect(() => {
    if (queuedDraft) setError(null);
  }, [queuedDraft]);

  const settle = useCallback((requestId: string): PendingSend | null => {
    const entry = pending.current.get(requestId);
    if (!entry) return null;
    window.clearTimeout(entry.timeoutId);
    pending.current.delete(requestId);
    if (entry.sessionId === currentSessionId.current) setSendingContent(null);
    return entry;
  }, []);

  const recoverUnconfirmed = useCallback((requestId: string) => {
    const entry = settle(requestId);
    if (!entry) return;
    returnDraftToInput(entry.draft.content);
    if (entry.sessionId === currentSessionId.current) {
      setError('Could not confirm it was sent. Check the conversation before sending again.');
    }
    void sessionStore.refreshFromServer(entry.sessionId);
  }, [returnDraftToInput, sessionStore, settle]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected') {
      for (const requestId of [...pending.current.keys()]) recoverUnconfirmed(requestId);
      return;
    }
    const requestId = typeof event.requestId === 'string' ? event.requestId : '';
    if (!pending.current.has(requestId)) return;

    if (event.kind === 'chat_input_accepted') {
      const entry = settle(requestId);
      if (!entry) return;
      sessionStore.appendRealtime(entry.sessionId, {
        id: `local_steer_${requestId}`,
        sessionId: entry.sessionId,
        timestamp: new Date().toISOString(),
        provider: entry.provider,
        kind: 'text',
        role: 'user',
        content: entry.draft.content,
      });
    } else if (event.kind === 'chat_input_rejected') {
      const entry = settle(requestId);
      if (!entry) return;
      requeueQueuedDraft(entry.sessionId, entry.draft);
      if (entry.sessionId === currentSessionId.current) {
        setError(event.code === 'NO_ACTIVE_RUN'
          ? 'The reply had already finished, so it stays queued.'
          : 'The turn could not take it now, so it stays queued.');
      }
    }
  }), [recoverUnconfirmed, requeueQueuedDraft, sessionStore, settle, subscribe]);

  useEffect(() => () => {
    for (const entry of pending.current.values()) window.clearTimeout(entry.timeoutId);
  }, []);

  const content = queuedDraft?.content.trim() ?? '';
  const canSendNow = Boolean(
    canSteer
    && isProcessing
    && sessionId
    && content
    && queuedDraft
    && queuedDraft.attachments.length === 0
    && (queuedDraft.uploadedAttachments?.length ?? 0) === 0,
  );

  const sendNow = useCallback(() => {
    if (!canSendNow || !sessionId || !queuedDraft) return;
    const requestId = `queued_steer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const draft = queuedDraft;
    deleteQueuedDraft();
    setError(null);
    const sent = sendMessage({ type: 'chat.steer', requestId, sessionId, content: draft.content.trim() });
    if (!sent) {
      requeueQueuedDraft(sessionId, draft);
      setError('Connection lost, so it stays queued.');
      return;
    }
    setSendingContent(draft.content);
    pending.current.set(requestId, {
      sessionId,
      provider,
      draft,
      timeoutId: window.setTimeout(() => recoverUnconfirmed(requestId), STEER_ACK_TIMEOUT_MS),
    });
  }, [canSendNow, deleteQueuedDraft, provider, queuedDraft, recoverUnconfirmed, requeueQueuedDraft, sendMessage, sessionId]);

  return {
    sendNow: canSendNow ? sendNow : undefined,
    sendingContent,
    error,
    dismissError: () => setError(null),
  };
}
