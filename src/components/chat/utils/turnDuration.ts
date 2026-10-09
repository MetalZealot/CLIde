import type { ChatMessage } from '../types/types';

import { formatReplyCopyText } from './chatFormatting';

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
  /** Every reply in the turn, for its single Copy. */
  replyText: string;
  /** The last reply alone, for Speak: it usually sums up the turn. */
  spokenText: string;
  durationMs?: number;
  /** Absent when the provider records none or the turn's prompt is not loaded. */
  outputTokens?: number;
};

/**
 * Each finished turn's reply text, duration and output tokens, keyed by its last reply.
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
  let replyTexts: string[] = [];

  const closeTurn = () => {
    if (!lastReply) return;
    const summary: TurnSummary = { replyText: replyTexts.filter(Boolean).join('\n\n'), spokenText: replyTexts.at(-1) ?? '' };
    const durationMs = turnStart === null ? NaN : readTime(lastReply.timestamp) - turnStart;
    if (Number.isFinite(durationMs) && durationMs >= 1000) summary.durationMs = durationMs;
    if (countsTokens && outputTokens > 0) summary.outputTokens = outputTokens;
    summaries.set(lastReply, summary);
  };

  for (const message of messages) {
    if (isTurnStart(message)) {
      closeTurn();
      turnStart = readTime(message.timestamp);
      countsTokens = true;
      outputTokens = 0;
      lastReply = null;
      replyTexts = [];
    } else if (isReplyText(message)) {
      lastReply = message;
      replyTexts.push(formatReplyCopyText(String(message.content || ''), message.followUpQuestions));
    }
    outputTokens += message.outputTokens ?? 0;
  }
  // A running turn has no final reply yet.
  if (!isProcessing) closeTurn();

  return summaries;
}
