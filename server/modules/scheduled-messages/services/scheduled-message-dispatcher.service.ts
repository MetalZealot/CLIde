import { scheduledMessagesDb, type ScheduledMessageRow } from '@/modules/database/index.js';

/**
 * Fires scheduled messages.
 *
 * The database row is the only durable record: timers live in memory and are
 * rebuilt from `listPending()` on every start, so a restart between scheduling
 * and firing loses nothing. `claimForSend` takes a row from 'pending' in one
 * statement, which is what makes a timer and the startup sweep safe to race.
 *
 * A paused row is never armed and never claimed. Resuming re-arms it: a time
 * that passed meanwhile fires at once, and so does a usage reset that was
 * recorded as missed while it was paused.
 */

/** setTimeout saturates above this, firing immediately; re-arm in hops instead. */
const MAX_TIMER_MS = 2_147_483_647;

export type DispatchResult = { ok: true } | { ok: false; reason: string };

export type ScheduledMessageDispatcherDependencies = {
  /** Starts the turn. Rejecting or returning a reason leaves the row 'failed'. */
  send(row: ScheduledMessageRow): Promise<DispatchResult>;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

/** The dispatcher's public surface, as the runtime seam and its tests hold it. */
export type ScheduledMessageDispatcher = {
  reconcile(): void;
  /** Arms a pending row, firing it now if it has fallen due; drops the timer of any other. */
  schedule(row: ScheduledMessageRow): void;
  cancel(id: string): boolean;
  /** Sends a pending row now, ahead of its trigger. False when it is not pending. */
  sendNow(id: string): boolean;
  fireUsageReset(provider: string): Promise<void>;
  close(): void;
};

export function createScheduledMessageDispatcher(
  dependencies: ScheduledMessageDispatcherDependencies,
): ScheduledMessageDispatcher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelTimer = (id: string) => {
    const timer = timers.get(id);
    if (timer) {
      dependencies.clearTimeout(timer);
      timers.delete(id);
    }
  };

  /**
   * Sends one row, if this caller is the one that claims it.
   *
   * The claim moves the row out of 'pending' before the send is attempted, so
   * a crash mid-send costs one message rather than resending it on every
   * restart. A send that comes back unhappy is then recorded against the row
   * this process already owns.
   */
  const fire = async (id: string): Promise<void> => {
    cancelTimer(id);
    const row = scheduledMessagesDb.getById(id);
    if (!row || !scheduledMessagesDb.claimForSend(id)) {
      return;
    }

    try {
      const result = await dependencies.send(row);
      if (!result.ok) {
        scheduledMessagesDb.markFailed(id, result.reason);
        console.error('[ScheduledMessages] Send refused', { id, reason: result.reason });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      scheduledMessagesDb.markFailed(id, reason);
      console.error('[ScheduledMessages] Send threw', { id, reason });
    }
  };

  /** When a pending row fires on its own; null while it waits on a reset the monitor delivers. */
  const dueAt = (row: ScheduledMessageRow): number | null => {
    if (row.trigger_kind === 'time') return Date.parse(row.scheduled_for ?? '');
    return row.reset_missed ? dependencies.now() : null;
  };

  const arm = (row: ScheduledMessageRow): void => {
    cancelTimer(row.id);
    if (row.state !== 'pending') return;

    const fireAt = dueAt(row);
    if (fireAt === null) return;
    if (!Number.isFinite(fireAt)) {
      scheduledMessagesDb.fail(row.id, 'scheduled_for is not a valid instant');
      return;
    }

    const delay = fireAt - dependencies.now();
    if (delay <= 0) {
      void fire(row.id);
      return;
    }

    // Every hop re-reads the row, so a pause or an edit is picked up.
    const hop = Math.min(delay, MAX_TIMER_MS);
    timers.set(
      row.id,
      dependencies.setTimeout(() => {
        timers.delete(row.id);
        const latest = scheduledMessagesDb.getById(row.id);
        if (latest) arm(latest);
      }, hop),
    );
  };

  return {
    /** Rebuilds every pending timer. Safe to call more than once. */
    reconcile(): void {
      for (const row of scheduledMessagesDb.listPending()) {
        arm(row);
      }
    },

    schedule(row: ScheduledMessageRow): void {
      arm(row);
    },

    cancel(id: string): boolean {
      cancelTimer(id);
      return scheduledMessagesDb.cancel(id);
    },

    // The claim inside `fire` runs before its first await, so no timer can take the row between.
    sendNow(id: string): boolean {
      if (scheduledMessagesDb.getById(id)?.state !== 'pending') return false;
      void fire(id);
      return true;
    },

    /**
     * Fires every pending row waiting on this provider's usage reset. A paused
     * one cannot go, so the reset is recorded on it and resuming fires it.
     */
    async fireUsageReset(provider: string): Promise<void> {
      for (const row of scheduledMessagesDb.listWaitingForUsageReset(provider)) {
        if (row.state === 'paused') {
          scheduledMessagesDb.markResetMissed(row.id);
        } else {
          await fire(row.id);
        }
      }
    },

    close(): void {
      for (const timer of timers.values()) {
        dependencies.clearTimeout(timer);
      }
      timers.clear();
    },
  };
}
