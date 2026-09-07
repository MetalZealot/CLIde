import type { ChatMessage, FollowUpQuestion } from '../types/types';
import type { LLMProvider } from '../../../types/app';

import { safeLocalStorage, type QueuedSendOptions } from './chatStorage';

const HANDLED_PREFIX = 'async_question_handled_';
const QUEUE_PREFIX = 'async_question_queue_';
const DRAFT_PREFIX = 'async_question_draft_';
const MAX_HANDLED_QUESTIONS = 200;
const MAX_QUEUED_ANSWERS = 100;

export const ASYNC_QUESTION_QUEUE_CHANGED_EVENT = 'clide:async-question-queue-changed';
export const ASYNC_ANSWER_DISPATCHED_EVENT = 'clide:async-answer-dispatched';

export type PendingAsyncQuestion = FollowUpQuestion & {
  id: string;
  messageId: string;
};

export type HandledAsyncQuestion = {
  id: string;
  content: string;
};

export type QueuedAsyncAnswer = {
  id: string;
  questionId: string;
  question: string;
  answer: string;
  content: string;
  provider: LLMProvider;
  options?: QueuedSendOptions;
  queuedAt: string;
};

const handledKey = (sessionId: string) => `${HANDLED_PREFIX}${sessionId}`;
const queueKey = (sessionId: string) => `${QUEUE_PREFIX}${sessionId}`;
export const asyncQuestionDraftKey = (sessionId: string, questionId: string) =>
  `${DRAFT_PREFIX}${sessionId}:${questionId}`;

function readArray<T>(key: string, validate: (value: unknown) => value is T): T[] {
  const raw = safeLocalStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(validate) : [];
  } catch {
    return [];
  }
}

function isHandledQuestion(value: unknown): value is HandledAsyncQuestion {
  const item = value as Partial<HandledAsyncQuestion> | null;
  return Boolean(item && typeof item.id === 'string' && typeof item.content === 'string');
}

function isQueuedAnswer(value: unknown): value is QueuedAsyncAnswer {
  const item = value as Partial<QueuedAsyncAnswer> | null;
  return Boolean(
    item
    && typeof item.id === 'string'
    && typeof item.questionId === 'string'
    && typeof item.question === 'string'
    && typeof item.answer === 'string'
    && typeof item.content === 'string'
    && ['claude', 'cursor', 'codex', 'opencode'].includes(String(item.provider))
    && (item.options === undefined || (
      typeof item.options === 'object' && item.options !== null && !Array.isArray(item.options)
    ))
    && typeof item.queuedAt === 'string',
  );
}

function notifyQueueChanged(sessionId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ASYNC_QUESTION_QUEUE_CHANGED_EVENT, {
      detail: { sessionId },
    }));
  }
}

export function notifyAsyncAnswerDispatched(
  sessionId: string,
  provider: LLMProvider,
  content: string,
): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ASYNC_ANSWER_DISPATCHED_EVENT, {
      detail: { sessionId, provider, content },
    }));
  }
}

export function readHandledAsyncQuestions(sessionId: string): HandledAsyncQuestion[] {
  return readArray(handledKey(sessionId), isHandledQuestion);
}

export function markAsyncQuestionHandled(
  sessionId: string,
  questionId: string,
  content: string,
): void {
  const next = [
    ...readHandledAsyncQuestions(sessionId).filter((item) => item.id !== questionId),
    { id: questionId, content },
  ].slice(-MAX_HANDLED_QUESTIONS);
  safeLocalStorage.setItem(handledKey(sessionId), JSON.stringify(next));
}

export function unmarkAsyncQuestionHandled(sessionId: string, questionId: string): void {
  const next = readHandledAsyncQuestions(sessionId).filter((item) => item.id !== questionId);
  if (next.length === 0) {
    safeLocalStorage.removeItem(handledKey(sessionId));
  } else {
    safeLocalStorage.setItem(handledKey(sessionId), JSON.stringify(next));
  }
}

export function formatAsyncQuestionAnswer(question: string, answer: string): string {
  return `> ${question.trim()}\n\n${answer.trim()}`;
}

/**
 * Rebuilds pending state from transcript history plus the local handled ledger.
 * A framed user reply consumes its matching earlier question; local/native
 * echoes already in the ledger do not consume the next question in the FIFO.
 */
export function collectPendingAsyncQuestions(
  messages: ChatMessage[],
  handled: HandledAsyncQuestion[],
): PendingAsyncQuestion[] {
  const handledIds = new Set(handled.map((item) => item.id));
  const handledEchoCounts = new Map<string, number>();
  for (const item of handled) {
    const text = item.content.trim();
    handledEchoCounts.set(text, (handledEchoCounts.get(text) ?? 0) + 1);
  }

  const pending: PendingAsyncQuestion[] = [];
  for (const message of messages) {
    if (message.type === 'assistant' && message.followUpQuestions?.length) {
      const messageId = message.id || `${String(message.timestamp)}:${message.followUpQuestions[0]?.question ?? ''}`;
      message.followUpQuestions.forEach((question, index) => {
        const id = `${messageId}:${index}`;
        if (!handledIds.has(id)) {
          pending.push({ ...question, id, messageId });
        }
      });
      continue;
    }

    if (message.type !== 'user' || message.id?.startsWith('local_')) {
      continue;
    }
    const content = (message.content ?? '').trim();
    const knownEchoes = handledEchoCounts.get(content) ?? 0;
    if (knownEchoes > 0) {
      handledEchoCounts.set(content, knownEchoes - 1);
    } else if (pending[0] && content.startsWith(`> ${pending[0].question.trim()}\n\n`)) {
      pending.shift();
    }
  }
  return pending;
}

export function readQueuedAsyncAnswers(sessionId: string): QueuedAsyncAnswer[] {
  return readArray(queueKey(sessionId), isQueuedAnswer);
}

export function enqueueAsyncAnswer(sessionId: string, answer: QueuedAsyncAnswer): void {
  safeLocalStorage.setItem(
    queueKey(sessionId),
    JSON.stringify([...readQueuedAsyncAnswers(sessionId), answer].slice(-MAX_QUEUED_ANSWERS)),
  );
  notifyQueueChanged(sessionId);
}

export function removeQueuedAsyncAnswer(sessionId: string, answerId: string): QueuedAsyncAnswer | null {
  const queue = readQueuedAsyncAnswers(sessionId);
  const removed = queue.find((item) => item.id === answerId) ?? null;
  const next = queue.filter((item) => item.id !== answerId);
  if (next.length === 0) {
    safeLocalStorage.removeItem(queueKey(sessionId));
  } else {
    safeLocalStorage.setItem(queueKey(sessionId), JSON.stringify(next));
  }
  if (removed) notifyQueueChanged(sessionId);
  return removed;
}

export function listAsyncAnswerQueueSessionIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(QUEUE_PREFIX))
      .map((key) => key.slice(QUEUE_PREFIX.length))
      .filter(Boolean);
  } catch {
    return [];
  }
}
