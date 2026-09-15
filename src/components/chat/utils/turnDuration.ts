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

/**
 * Wall-clock time from each prompt to the last reply text of its turn, keyed by that reply.
 * Timestamps, not provider timers: Claude does not persist one, and this ran under 3s short
 * of Claude's and Codex's recorded durations (measured 2026-09-14).
 */
export function computeTurnDurations(
  messages: ChatMessage[],
  isProcessing: boolean,
  /** Prompt time for the messages before the first loaded prompt, when that prompt is not loaded. */
  leadingTurnStartedAt: string | null = null,
): WeakMap<ChatMessage, number> {
  const durations = new WeakMap<ChatMessage, number>();
  let turnStart: number | null = leadingTurnStartedAt ? readTime(leadingTurnStartedAt) : null;
  let lastReply: ChatMessage | null = null;

  const closeTurn = () => {
    if (turnStart === null || !lastReply) return;
    const durationMs = readTime(lastReply.timestamp) - turnStart;
    if (Number.isFinite(durationMs) && durationMs >= 1000) {
      durations.set(lastReply, durationMs);
    }
  };

  for (const message of messages) {
    if (isTurnStart(message)) {
      closeTurn();
      turnStart = readTime(message.timestamp);
      lastReply = null;
    } else if (isReplyText(message)) {
      lastReply = message;
    }
  }
  // A running turn has no final reply yet.
  if (!isProcessing) closeTurn();

  return durations;
}
