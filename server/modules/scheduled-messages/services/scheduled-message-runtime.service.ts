import {
  scheduledMessagesDb,
  type CreateScheduledMessageInput,
  type ScheduledMessageRow,
} from '@/modules/database/index.js';
import { normalizeAttachmentDescriptors, type ChatAttachmentDescriptor } from '@/shared/image-attachments.js';
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
   * Called whenever a row starts or stops waiting. The usage-reset monitor
   * only polls a provider something is waiting on, so a message scheduled
   * while reset alerts are off would otherwise wait on a monitor that was
   * never started.
   */
  onPendingChanged(): void;
  /** Whether a turn is running in the session, which a send now would be refused by. */
  isSessionBusy(sessionId: string): boolean;
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

/** Cancels an unsent message. False means it was already sent or cancelled. */
export function cancelScheduledMessage(id: string): boolean {
  const cancelled = runtime
    ? runtime.dispatcher.cancel(id)
    : scheduledMessagesDb.cancel(id);
  if (cancelled) runtime?.onPendingChanged();
  return cancelled;
}

/**
 * Sends a waiting message now instead of at its trigger. Consumed by the
 * scheduled-messages routes. A busy session is refused before the row is
 * claimed, so the message keeps waiting rather than being recorded as failed.
 */
export function sendScheduledMessageNow(id: string): 'sent' | 'not-pending' | 'busy' | 'unavailable' {
  if (!runtime) return 'unavailable';
  const row = scheduledMessagesDb.getById(id);
  if (!row || row.state !== 'pending') return 'not-pending';
  if (runtime.isSessionBusy(row.session_id)) return 'busy';
  if (!runtime.dispatcher.sendNow(id)) return 'not-pending';
  runtime.onPendingChanged();
  return 'sent';
}

/**
 * Opens a message for editing: it stays listed as waiting but cannot fire
 * until resumed, however long the editor is away. Consumed by the
 * scheduled-messages routes. Null when the message is no longer unsent.
 */
export function pauseScheduledMessage(id: string): ScheduledMessageRow | null {
  if (!scheduledMessagesDb.pause(id)) return null;
  const row = scheduledMessagesDb.getById(id);
  if (row) {
    runtime?.dispatcher.schedule(row);
    runtime?.onPendingChanged();
  }
  return row;
}

/**
 * Puts a paused message back to waiting, rewritten when an edit is saved. It
 * keeps its trigger; a time or reset that passed while paused fires it now.
 * Consumed by the scheduled-messages routes. Null when it is not paused.
 */
export function resumeScheduledMessage(
  id: string,
  edit?: { content: string; options: unknown },
): ScheduledMessageRow | null {
  if (!scheduledMessagesDb.resume(id, edit)) return null;
  const row = scheduledMessagesDb.getById(id);
  if (row) {
    runtime?.dispatcher.schedule(row);
    runtime?.onPendingChanged();
  }
  return row;
}

/**
 * The attachments stored with a message. Consumed by the scheduled-messages
 * routes, so an edit can restore them, and by the websocket wiring, so the
 * bubble drawn when the message sends matches the transcript copy it becomes.
 */
export function readScheduledMessageAttachments(row: ScheduledMessageRow): ChatAttachmentDescriptor[] {
  try {
    const options: unknown = JSON.parse(row.options ?? 'null');
    return options && typeof options === 'object'
      ? normalizeAttachmentDescriptors((options as { attachments?: unknown }).attachments)
      : [];
  } catch {
    return [];
  }
}

/** Every message ever scheduled in one session, newest first. */
export function listScheduledMessagesForSession(sessionId: string): ScheduledMessageRow[] {
  return scheduledMessagesDb.listBySession(sessionId);
}

/**
 * Whether a message, paused or not, is waiting on this provider's usage reset.
 *
 * Consumed by the usage-reset monitor to decide whether to keep polling a
 * provider whose reset alerts are switched off. A paused message counts: the
 * reset it misses has to be observed to be recorded. Without a runtime nothing
 * can be sent, so there is nothing worth keeping a monitor awake for.
 */
export function hasPendingUsageResetMessages(provider: LLMProvider): boolean {
  return runtime !== null
    && scheduledMessagesDb.listWaitingForUsageReset(provider).length > 0;
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
