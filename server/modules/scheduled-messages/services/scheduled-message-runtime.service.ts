import { scheduledMessagesDb } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import type { ScheduledMessageDispatcher } from './scheduled-message-dispatcher.service.js';

/**
 * The one dispatcher a running server sends through.
 *
 * The usage-reset monitor lives in the providers module and fires at an
 * instant it alone knows; it reaches the dispatcher through here rather than
 * constructing one, so both consumers of a reset settle the same rows.
 */
let activeDispatcher: ScheduledMessageDispatcher | null = null;

/** Registered during startup, once a dispatcher can reach the chat runtime. */
export function setActiveScheduledMessageDispatcher(
  dispatcher: ScheduledMessageDispatcher | null,
): void {
  activeDispatcher = dispatcher;
}

/**
 * Whether a message is waiting on this provider's usage reset.
 *
 * Consumed by the usage-reset monitor to decide whether to keep polling a
 * provider whose reset alerts are switched off. Without a dispatcher nothing
 * can be sent, so there is nothing worth keeping a monitor awake for.
 */
export function hasPendingUsageResetMessages(provider: LLMProvider): boolean {
  return activeDispatcher !== null
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
  await activeDispatcher?.fireUsageReset(provider);
}
