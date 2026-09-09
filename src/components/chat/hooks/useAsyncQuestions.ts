import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { SessionStore } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import type { LLMProvider } from '../../../types/app';
import {
  ASYNC_ANSWER_DISPATCHED_EVENT,
  ASYNC_QUESTION_QUEUE_CHANGED_EVENT,
  asyncQuestionDraftKey,
  collectPendingAsyncQuestions,
  enqueueAsyncAnswer,
  formatAsyncQuestionAnswer,
  markAsyncQuestionHandled,
  readHandledAsyncQuestions,
  readQueuedAsyncAnswers,
  removeQueuedAsyncAnswer,
  unmarkAsyncQuestionHandled,
  type PendingAsyncQuestion,
} from '../utils/asyncQuestionState';
import { safeLocalStorage, type QueuedSendOptions } from '../utils/chatStorage';

type Delivery = 'send' | 'queue';

const ANSWER_ACK_TIMEOUT_MS = 15_000;

type UseAsyncQuestionsArgs = {
  sessionId: string | null;
  provider: LLMProvider;
  messages: ChatMessage[];
  isProcessing: boolean;
  sendOptions: QueuedSendOptions;
  sendMessage: (message: unknown) => boolean;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  sessionStore: SessionStore;
  onSessionProcessing?: MarkSessionProcessing;
};

function appendLocalAnswer(
  sessionStore: SessionStore,
  sessionId: string,
  provider: LLMProvider,
  content: string,
): void {
  sessionStore.appendRealtime(sessionId, {
    id: `local_async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: new Date().toISOString(),
    provider,
    kind: 'text',
    role: 'user',
    content,
  });
}

export function useAsyncQuestions({
  sessionId,
  provider,
  messages,
  isProcessing,
  sendOptions,
  sendMessage,
  subscribe,
  sessionStore,
  onSessionProcessing,
}: UseAsyncQuestionsArgs) {
  const [revision, setRevision] = useState(0);
  const [sendingQuestionId, setSendingQuestionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;
  const pendingSteers = useRef(new Map<string, {
    sessionId: string;
    provider: LLMProvider;
    question: PendingAsyncQuestion;
    content: string;
    timeoutId: number;
  }>());

  // `revision` makes localStorage writes observable to this hook. Reading is
  // cheap (bounded ledgers), and avoids memo dependencies on external state.
  void revision;
  const handled = sessionId ? readHandledAsyncQuestions(sessionId) : [];
  const pending = collectPendingAsyncQuestions(messages, handled);
  const queued = sessionId ? readQueuedAsyncAnswers(sessionId) : [];

  useEffect(() => {
    const handleQueueChanged = () => setRevision((value) => value + 1);
    const handleDispatched = (event: Event) => {
      const detail = (event as CustomEvent<{
        sessionId?: unknown;
        provider?: unknown;
        content?: unknown;
      }>).detail;
      if (
        typeof detail?.sessionId !== 'string'
        || !['claude', 'cursor', 'codex', 'opencode'].includes(String(detail.provider))
        || typeof detail.content !== 'string'
      ) return;
      appendLocalAnswer(
        sessionStore,
        detail.sessionId,
        detail.provider as LLMProvider,
        detail.content,
      );
    };
    window.addEventListener(ASYNC_QUESTION_QUEUE_CHANGED_EVENT, handleQueueChanged);
    window.addEventListener(ASYNC_ANSWER_DISPATCHED_EVENT, handleDispatched);
    return () => {
      window.removeEventListener(ASYNC_QUESTION_QUEUE_CHANGED_EVENT, handleQueueChanged);
      window.removeEventListener(ASYNC_ANSWER_DISPATCHED_EVENT, handleDispatched);
    };
  }, [sessionStore]);

  useEffect(() => {
    setSendingQuestionId(null);
    setError(null);
  }, [sessionId]);

  const recoverUnconfirmed = useCallback((requestId: string) => {
    const pendingSteer = pendingSteers.current.get(requestId);
    if (!pendingSteer) return;
    window.clearTimeout(pendingSteer.timeoutId);
    pendingSteers.current.delete(requestId);
    if (pendingSteer.sessionId === currentSessionId.current) {
      setSendingQuestionId(null);
      setError('Could not confirm answer delivery. Check the conversation before retrying.');
    }
    // Transcript replies settle pending questions; uncertain sends must never replay.
    void sessionStore.refreshFromServer(pendingSteer.sessionId);
  }, [sessionStore]);

  useEffect(() => {
    if (isProcessing) return;
    for (const [requestId, pendingSteer] of pendingSteers.current) {
      if (pendingSteer.sessionId === sessionId) recoverUnconfirmed(requestId);
    }
  }, [isProcessing, recoverUnconfirmed, sessionId]);

  useEffect(() => {
    const requests = pendingSteers.current;
    return () => {
      for (const request of requests.values()) window.clearTimeout(request.timeoutId);
      requests.clear();
    };
  }, []);

  const accept = useCallback((
    targetSessionId: string,
    targetProvider: LLMProvider,
    question: PendingAsyncQuestion,
    content: string,
  ) => {
    markAsyncQuestionHandled(targetSessionId, question.id, content);
    safeLocalStorage.removeItem(asyncQuestionDraftKey(targetSessionId, question.id));
    appendLocalAnswer(sessionStore, targetSessionId, targetProvider, content);
    if (targetSessionId === currentSessionId.current) {
      setSendingQuestionId(null);
      setError(null);
    }
    setRevision((value) => value + 1);
  }, [sessionStore]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected') {
      for (const requestId of pendingSteers.current.keys()) recoverUnconfirmed(requestId);
      return;
    }
    const requestId = typeof event.requestId === 'string' ? event.requestId : '';
    const pendingSteer = pendingSteers.current.get(requestId);
    if (!pendingSteer) return;

    if (event.kind === 'chat_input_accepted') {
      window.clearTimeout(pendingSteer.timeoutId);
      pendingSteers.current.delete(requestId);
      accept(
        pendingSteer.sessionId,
        pendingSteer.provider,
        pendingSteer.question,
        pendingSteer.content,
      );
    } else if (event.kind === 'chat_input_rejected') {
      window.clearTimeout(pendingSteer.timeoutId);
      pendingSteers.current.delete(requestId);
      if (pendingSteer.sessionId === sessionId) {
        setSendingQuestionId(null);
        setError(typeof event.error === 'string' ? event.error : 'The provider did not accept the answer.');
      }
    }
  }), [accept, recoverUnconfirmed, sessionId, subscribe]);

  const submit = useCallback((
    question: PendingAsyncQuestion,
    answer: string,
    delivery: Delivery,
  ): boolean => {
    if (!sessionId || !answer.trim()) return false;
    const content = formatAsyncQuestionAnswer(question.question, answer);
    setError(null);

    if (delivery === 'queue') {
      enqueueAsyncAnswer(sessionId, {
        id: `async_answer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        questionId: question.id,
        question: question.question,
        answer: answer.trim(),
        content,
        provider,
        options: sendOptions,
        queuedAt: new Date().toISOString(),
      });
      markAsyncQuestionHandled(sessionId, question.id, content);
      safeLocalStorage.removeItem(asyncQuestionDraftKey(sessionId, question.id));
      setRevision((value) => value + 1);
      return true;
    }

    if (!isProcessing) {
      const sent = sendMessage({
        type: 'chat.send',
        sessionId,
        content,
        options: sendOptions,
      });
      if (!sent) {
        setError('Connection lost before the answer could be sent.');
        return false;
      }
      accept(sessionId, provider, question, content);
      onSessionProcessing?.(sessionId, { statusText: null, canInterrupt: true });
      return true;
    }

    const requestId = `async_steer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeoutId = window.setTimeout(() => recoverUnconfirmed(requestId), ANSWER_ACK_TIMEOUT_MS);
    pendingSteers.current.set(requestId, { sessionId, provider, question, content, timeoutId });
    setSendingQuestionId(question.id);
    const sent = sendMessage({ type: 'chat.steer', requestId, sessionId, content });
    if (!sent) {
      window.clearTimeout(timeoutId);
      pendingSteers.current.delete(requestId);
      setSendingQuestionId(null);
      setError('Connection lost before the answer could be sent.');
    }
    return sent;
  }, [accept, isProcessing, onSessionProcessing, provider, recoverUnconfirmed, sendMessage, sendOptions, sessionId]);

  const removeQueued = useCallback((answerId: string) => {
    if (!sessionId) return;
    const removed = removeQueuedAsyncAnswer(sessionId, answerId);
    if (removed) {
      unmarkAsyncQuestionHandled(sessionId, removed.questionId);
      setRevision((value) => value + 1);
    }
  }, [sessionId]);

  return {
    pendingQuestion: pending[0] ?? null,
    pendingCount: pending.length,
    queued,
    sendingQuestionId,
    error,
    submit,
    removeQueued,
  };
}
