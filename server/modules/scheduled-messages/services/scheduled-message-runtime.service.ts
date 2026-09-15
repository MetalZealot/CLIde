import { randomUUID } from 'node:crypto';

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

/** Chosen, not measured: survives two lost renewals, frees a closed app's hold in 90s. */
const SCHEDULED_MESSAGE_HOLD_MS = 90_000;

/**
 * Holds a pending message for editing, taking it from any earlier editor.
 *
 * Consumed by the scheduled-messages routes when an edit opens. Returns the
 * token the editor renews, releases, and saves with, or null when the message
 * is no longer pending.
 */
export function holdScheduledMessage(id: string): { token: string; row: ScheduledMessageRow } | null {
  const token = randomUUID();
  if (!scheduledMessagesDb.hold(id, token, Date.now() + SCHEDULED_MESSAGE_HOLD_MS)) {
    return null;
  }
  const row = scheduledMessagesDb.getById(id);
  return row ? { token, row } : null;
}

/**
 * Keeps an open edit's hold alive. False means the message sent, was
 * cancelled, or another editor took it, so this edit can no longer be saved.
 * Consumed by the scheduled-messages routes.
 */
export function renewScheduledMessageHold(id: string, token: string): boolean {
  return scheduledMessagesDb.renewHold(id, token, Date.now() + SCHEDULED_MESSAGE_HOLD_MS);
}

/**
 * Ends an edit without saving, so the message waits again and fires at once if
 * what it waited for passed meanwhile. Consumed by the scheduled-messages routes.
 */
export function releaseScheduledMessageHold(id: string, token: string): boolean {
  const released = scheduledMessagesDb.releaseHold(id, token);
  if (released) runtime?.dispatcher.rearm(id);
  return released;
}

/**
 * Saves an edit and ends its hold; the message keeps its trigger and catches
 * up exactly as a release does. Consumed by the scheduled-messages routes.
 */
export function saveScheduledMessageEdit(
  id: string,
  token: string,
  edit: { content: string; options?: unknown },
): ScheduledMessageRow | null {
  if (!scheduledMessagesDb.saveEdit(id, token, edit.content, edit.options)) {
    return null;
  }
  const row = scheduledMessagesDb.getById(id);
  runtime?.dispatcher.rearm(id);
  return row;
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
