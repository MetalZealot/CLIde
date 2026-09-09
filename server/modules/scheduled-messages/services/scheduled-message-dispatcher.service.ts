import { scheduledMessagesDb, type ScheduledMessageRow } from '@/modules/database/index.js';

/**
 * Fires scheduled messages.
 *
 * The database row is the only durable record: timers live in memory and are
 * rebuilt from `listPending()` on every start, so a restart between scheduling
 * and firing loses nothing. `settle` claims a row from 'pending' in one
 * statement, which is what makes a timer and the startup sweep safe to race.
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

export function createScheduledMessageDispatcher(
  dependencies: ScheduledMessageDispatcherDependencies,
) {
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
    if (!row || row.state !== 'pending') {
      return;
    }
    if (!scheduledMessagesDb.settle(id, 'sent')) {
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

  const arm = (row: ScheduledMessageRow) => {
    if (row.trigger_kind !== 'time' || !row.scheduled_for) {
      return;
    }
    const dueAt = Date.parse(row.scheduled_for);
    if (!Number.isFinite(dueAt)) {
      scheduledMessagesDb.settle(row.id, 'failed', 'scheduled_for is not a valid instant');
      return;
    }

    cancelTimer(row.id);
    const delay = dueAt - dependencies.now();
    if (delay <= 0) {
      void fire(row.id);
      return;
    }

    const hop = Math.min(delay, MAX_TIMER_MS);
    timers.set(
      row.id,
      dependencies.setTimeout(() => {
        timers.delete(row.id);
        const latest = scheduledMessagesDb.getById(row.id);
        if (latest && latest.state === 'pending') {
          arm(latest);
        }
      }, hop),
    );
  };

  return {
    /** Rebuilds every pending time trigger. Safe to call more than once. */
    reconcile(): void {
      for (const row of scheduledMessagesDb.listPending()) {
        if (row.trigger_kind === 'time') {
          arm(row);
        }
      }
    },

    /** Arms a row scheduled while the process was already running. */
    schedule(row: ScheduledMessageRow): void {
      arm(row);
    },

    cancel(id: string): boolean {
      cancelTimer(id);
      return scheduledMessagesDb.settle(id, 'cancelled');
    },

    /** Fires every pending row waiting on this provider's usage reset. */
    async fireUsageReset(provider: string): Promise<void> {
      for (const row of scheduledMessagesDb.listPendingForUsageReset(provider)) {
        await fire(row.id);
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
