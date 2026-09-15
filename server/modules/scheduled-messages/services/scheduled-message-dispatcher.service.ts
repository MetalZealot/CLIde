import { scheduledMessagesDb, type ScheduledMessageRow } from '@/modules/database/index.js';

/**
 * Fires scheduled messages.
 *
 * The database row is the only durable record: timers live in memory and are
 * rebuilt from `listPending()` on every start, so a restart between scheduling
 * and firing loses nothing. `claimForSend` takes a row from 'pending' in one
 * statement, which is what makes a timer and the startup sweep safe to race.
 *
 * A row held for editing is still pending but never fires. Whatever it was
 * waiting for is caught up when the hold ends, by release or by lapse: a time
 * that passed fires then, and so does a usage reset recorded as missed.
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
  schedule(row: ScheduledMessageRow): void;
  /** Re-arms a row whose hold just changed, firing it if it has fallen due. */
  rearm(id: string): void;
  cancel(id: string): boolean;
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

  const isHeld = (row: ScheduledMessageRow): boolean => (
    row.held_until !== null && row.held_until > dependencies.now()
  );

  /**
   * Sends one row, if this caller is the one that claims it.
   *
   * The claim moves the row out of 'pending' before the send is attempted, so
   * a crash mid-send costs one message rather than resending it on every
   * restart. A send that comes back unhappy is then recorded against the row
   * this process already owns.
   */
  const fire = async (id: string): Promise<void> => {
    const row = scheduledMessagesDb.getById(id);
    if (!row || row.state !== 'pending') {
      cancelTimer(id);
      return;
    }
    if (isHeld(row)) {
      if (row.trigger_kind === 'usage-reset' && !row.reset_missed) {
        scheduledMessagesDb.markResetMissed(id);
      }
      arm(scheduledMessagesDb.getById(id) ?? row);
      return;
    }
    cancelTimer(id);
    if (!scheduledMessagesDb.claimForSend(id, dependencies.now())) {
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

  /**
   * When a row may next fire: its instant, or for a usage reset that already
   * passed, now — pushed back to the end of any hold. Null when it waits on a
   * reset that has not happened, which the monitor delivers instead.
   */
  const nextFireAt = (row: ScheduledMessageRow): number | null => {
    let dueAt: number;
    if (row.trigger_kind === 'time') {
      dueAt = Date.parse(row.scheduled_for ?? '');
    } else if (row.reset_missed) {
      dueAt = dependencies.now();
    } else {
      return null;
    }
    return isHeld(row) ? Math.max(dueAt, row.held_until as number) : dueAt;
  };

  function arm(row: ScheduledMessageRow): void {
    const dueAt = nextFireAt(row);
    if (dueAt === null) {
      return;
    }
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

    // Every hop re-reads the row, so a renewed hold or an edit is picked up.
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
  }

  return {
    /** Rebuilds every pending timer, including held rows' lapses. Safe to call more than once. */
    reconcile(): void {
      for (const row of scheduledMessagesDb.listPending()) {
        arm(row);
      }
    },

    /** Arms a row scheduled while the process was already running. */
    schedule(row: ScheduledMessageRow): void {
      arm(row);
    },

    rearm(id: string): void {
      const row = scheduledMessagesDb.getById(id);
      if (row && row.state === 'pending') {
        arm(row);
      } else {
        cancelTimer(id);
      }
    },

    cancel(id: string): boolean {
      cancelTimer(id);
      return scheduledMessagesDb.settle(id, 'cancelled');
    },

    /** Fires every pending row waiting on this provider's usage reset; a held one fires on release. */
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
