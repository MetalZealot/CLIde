import { useMemo } from 'react';

import type { UsageLimitStop } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';

import type { ScheduledMessage } from './useScheduledMessages';

/**
 * How far back a limit stop is still the end of the conversation. A stop is
 * the last thing that happened or it is history; scanning the whole transcript
 * would resurrect an offer from weeks ago.
 */
const LOOKBACK = 12;

/**
 * Whether to offer Auto-Continue: the turn ended on a usage limit that lifts on
 * its own, nothing is already waiting on that reset, and the user has not moved
 * on since.
 *
 * The stop is recognised by the provider's own classification, carried on the
 * message as `usageLimit` — never by the notice's wording, which is localized
 * prose that has already changed shape once.
 */
export function resolveAutoContinueOffer(
  messages: ChatMessage[],
  pending: ScheduledMessage[],
  canScheduleOnUsageReset: boolean,
  nowMs: number = Date.now(),
): UsageLimitStop | null {
  if (!canScheduleOnUsageReset) return null;
  if (pending.some((message) => message.trigger === 'usage-reset')) return null;

  for (const message of messages.slice(-LOOKBACK).reverse()) {
    // Typing again is the user moving on; anything before that is history.
    if (message.type === 'user') return null;

    const stop = message.usageLimit;
    if (!stop) continue;
    // A spent balance never lifts, so waiting on it would be a lie.
    if (!stop.resumes) return null;
    // The provider's predicted instant is a hint, but a passed one means the
    // conversation is simply old and the offer has nothing left to buy.
    if (stop.resetsAt && Date.parse(stop.resetsAt) <= nowMs) return null;
    return stop;
  }

  return null;
}

export function useAutoContinueOffer(
  messages: ChatMessage[],
  pending: ScheduledMessage[],
  canScheduleOnUsageReset: boolean,
): UsageLimitStop | null {
  return useMemo(
    () => resolveAutoContinueOffer(messages, pending, canScheduleOnUsageReset),
    [canScheduleOnUsageReset, messages, pending],
  );
}
