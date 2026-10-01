import type { ChatMessage } from '../types/types';

const isTurnStart = (message: ChatMessage): boolean =>
  (message.type === 'user' && !message.isCompactSummary && !message.isLocalCommandStdout)
  || Boolean(message.isTaskNotification);

const isReplyText = (message: ChatMessage): boolean =>
  message.type === 'assistant'
  && !message.isToolUse
  && !message.isThinking
  && !message.isCompactSummary
  && !message.isTaskNotification
  && !message.isSystemNotice
  && (String(message.content || '').trim().length > 0 || Boolean(message.followUpQuestions?.length));

const readTime = (timestamp: ChatMessage['timestamp']): number => new Date(timestamp).getTime();

export type TurnSummary = {
  durationMs?: number;
  /** Absent when the provider records none or the turn's prompt is not loaded. */
  outputTokens?: number;
};

/**
 * Each finished turn's duration and output tokens, keyed by its last reply.
 * Duration is wall-clock from the prompt: Claude does not persist a timer, and this ran
 * under 3s short of Claude's and Codex's recorded durations (measured 2026-09-14).
 */
export function computeTurnSummaries(
  messages: ChatMessage[],
  isProcessing: boolean,
  /** Prompt time for the messages before the first loaded prompt, when that prompt is not loaded. */
  leadingTurnStartedAt: string | null = null,
  /** That turn's output tokens from the messages not loaded; without it the count would be short. */
  leadingTurnOutputTokens: number | null = null,
): WeakMap<ChatMessage, TurnSummary> {
  const summaries = new WeakMap<ChatMessage, TurnSummary>();
  let turnStart: number | null = leadingTurnStartedAt ? readTime(leadingTurnStartedAt) : null;
  let countsTokens = turnStart !== null && leadingTurnOutputTokens !== null;
  let outputTokens = leadingTurnOutputTokens ?? 0;
  let lastReply: ChatMessage | null = null;

  const closeTurn = () => {
    if (turnStart === null || !lastReply) return;
    const durationMs = readTime(lastReply.timestamp) - turnStart;
    const summary: TurnSummary = {};
    if (Number.isFinite(durationMs) && durationMs >= 1000) summary.durationMs = durationMs;
    if (countsTokens && outputTokens > 0) summary.outputTokens = outputTokens;
    if (summary.durationMs !== undefined || summary.outputTokens !== undefined) {
      summaries.set(lastReply, summary);
    }
  };

  for (const message of messages) {
    if (isTurnStart(message)) {
      closeTurn();
      turnStart = readTime(message.timestamp);
      countsTokens = true;
      outputTokens = 0;
      lastReply = null;
    } else if (isReplyText(message)) {
      lastReply = message;
    }
    outputTokens += message.outputTokens ?? 0;
  }
  // A running turn has no final reply yet.
  if (!isProcessing) closeTurn();

  return summaries;
}
