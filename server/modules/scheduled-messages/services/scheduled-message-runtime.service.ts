import {
  scheduledMessagesDb,
  type CreateScheduledMessageInput,
  type ScheduledMessageRow,
} from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import type { ScheduledMessageDispatcher } from './scheduled-message-dispatcher.service.js';

/**
 * What a running server supplies so scheduled messages can actually be sent.
 *
 * The module owns rows and timers but nothing that can start a turn, and it
 * deliberately imports neither the websocket nor the providers module — both
 * of those import this one. Startup registers the pieces instead.
 */
export type ScheduledMessageRuntime = {
  dispatcher: ScheduledMessageDispatcher;
  /**
   * Called whenever a row starts or stops being pending. The usage-reset
   * monitor only polls a provider something is waiting on, so a message
   * scheduled while reset alerts are off would otherwise wait on a monitor
   * that was never started.
   */
  onPendingChanged(): void;
};

let runtime: ScheduledMessageRuntime | null = null;

/** Registered during startup, and cleared on shutdown. */
export function setScheduledMessageRuntime(next: ScheduledMessageRuntime | null): void {
  runtime = next;
}

/**
 * Stores a message and arms it.
 *
 * A 'time' trigger gets its timer immediately; a 'usage-reset' one waits for
 * the reset monitor, which is why the monitor is reconciled either way.
 */
export function createScheduledMessage(input: CreateScheduledMessageInput): ScheduledMessageRow {
  const row = scheduledMessagesDb.create(input);
  runtime?.dispatcher.schedule(row);
  runtime?.onPendingChanged();
  return row;
}

/** Cancels a pending message. False means it was already sent or cancelled. */
export function cancelScheduledMessage(id: string): boolean {
  const cancelled = runtime
    ? runtime.dispatcher.cancel(id)
    : scheduledMessagesDb.settle(id, 'cancelled');
  if (cancelled) runtime?.onPendingChanged();
  return cancelled;
}

/** Every message ever scheduled in one session, newest first. */
export function listScheduledMessagesForSession(sessionId: string): ScheduledMessageRow[] {
  return scheduledMessagesDb.listBySession(sessionId);
}

/**
 * Whether a message is waiting on this provider's usage reset.
 *
 * Consumed by the usage-reset monitor to decide whether to keep polling a
 * provider whose reset alerts are switched off. Without a runtime nothing can
 * be sent, so there is nothing worth keeping a monitor awake for.
 */
export function hasPendingUsageResetMessages(provider: LLMProvider): boolean {
  return runtime !== null
    && scheduledMessagesDb.listPendingForUsageReset(provider).length > 0;
}

/**
 * Sends every message waiting on this provider's usage reset.
 *
 * Consumed by the usage-reset monitor at the reset instant. Each row is
 * claimed out of 'pending' by the dispatcher, so this is the whole dedupe:
 * it never reads or writes the notification identity list, and an alert and
 * an Auto-Continue for the same reset cannot suppress each other.
 */
export async function fireUsageResetMessages(provider: LLMProvider): Promise<void> {
  await runtime?.dispatcher.fireUsageReset(provider);
  runtime?.onPendingChanged();
}
