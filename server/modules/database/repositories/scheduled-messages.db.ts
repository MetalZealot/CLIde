import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type ScheduledMessageTrigger = 'time' | 'usage-reset';
/** 'pending' waits to fire; 'paused' is open for editing and never fires until resumed. */
export type ScheduledMessageState = 'pending' | 'paused' | 'sent' | 'cancelled' | 'failed';

export type ScheduledMessageRow = {
  id: string;
  session_id: string;
  provider: string;
  content: string;
  options: string | null;
  trigger_kind: ScheduledMessageTrigger;
  scheduled_for: string | null;
  state: ScheduledMessageState;
  failure_reason: string | null;
  created_at: string;
  fired_at: string | null;
  /** 1 once a usage reset passed while the row was paused; resuming then fires it. */
  reset_missed: number;
};

const COLUMNS =
  'id, session_id, provider, content, options, trigger_kind, scheduled_for, state, failure_reason, created_at, fired_at, reset_missed';

export type CreateScheduledMessageInput = {
  sessionId: string;
  provider: string;
  content: string;
  options?: unknown;
  trigger: ScheduledMessageTrigger;
  /** ISO instant; required for a 'time' trigger and ignored for 'usage-reset'. */
  scheduledFor?: string | null;
};

const serializeOptions = (options: unknown): string | null => (
  options === undefined ? null : JSON.stringify(options)
);

export const scheduledMessagesDb = {
  /**
   * Stores one message to be sent later.
   *
   * A 'time' trigger carries the instant it fires at; 'usage-reset' does not,
   * because the reset instant is only known once the provider is polled.
   */
  create(input: CreateScheduledMessageInput): ScheduledMessageRow {
    const db = getConnection();
    const id = randomUUID();
    const scheduledFor = input.trigger === 'time' ? input.scheduledFor ?? null : null;

    db.prepare(
      `INSERT INTO scheduled_messages (id, session_id, provider, content, options, trigger_kind, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.sessionId,
      input.provider,
      input.content,
      serializeOptions(input.options),
      input.trigger,
      scheduledFor,
    );

    return this.getById(id) as ScheduledMessageRow;
  },

  getById(id: string): ScheduledMessageRow | null {
    const db = getConnection();
    return (db
      .prepare(`SELECT ${COLUMNS} FROM scheduled_messages WHERE id = ?`)
      .get(id) as ScheduledMessageRow | undefined) ?? null;
  },

  /**
   * Every pending row, oldest first — what the dispatcher rebuilds its timers
   * from on startup, so nothing scheduled before a restart is forgotten.
   */
  listPending(): ScheduledMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE state = 'pending'
         ORDER BY COALESCE(scheduled_for, created_at) ASC`
      )
      .all() as ScheduledMessageRow[];
  },

  /** Unsent rows waiting on one provider's usage reset, paused ones included, oldest first. */
  listWaitingForUsageReset(provider: string): ScheduledMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE state IN ('pending', 'paused') AND trigger_kind = 'usage-reset' AND provider = ?
         ORDER BY created_at ASC`
      )
      .all(provider) as ScheduledMessageRow[];
  },

  /** Newest first; `created_at` has one-second resolution, so insertion order breaks ties. */
  listBySession(sessionId: string): ScheduledMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(sessionId) as ScheduledMessageRow[];
  },

  /** Session ids with at least one unsent message, for the sidebar status column. */
  listSessionIdsWithPending(): string[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT DISTINCT session_id FROM scheduled_messages WHERE state IN ('pending', 'paused')`
      )
      .all() as { session_id: string }[];
    return rows.map((row) => row.session_id);
  },

  /**
   * Claims a pending row for sending, and only a pending one.
   *
   * The guard is what makes firing safe to attempt twice: a dispatcher timer
   * and a startup sweep can race for the same row, and the loser writes
   * nothing. A paused row never matches, however the dispatcher reached it.
   */
  claimForSend(id: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = 'sent', fired_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state = 'pending'`
      )
      .run(id);
    return result.changes > 0;
  },

  /** Records a failed arm or send against an unsent row. */
  fail(id: string, reason: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = 'failed', failure_reason = ?, fired_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state IN ('pending', 'paused')`
      )
      .run(reason, id);
    return result.changes > 0;
  },

  /** Cancels an unsent row. False means it already sent, failed, or was cancelled. */
  cancel(id: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = 'cancelled', fired_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state IN ('pending', 'paused')`
      )
      .run(id);
    return result.changes > 0;
  },

  /** Opens a row for editing. Already paused counts as success, so a second device can take over. */
  pause(id: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages SET state = 'paused'
         WHERE id = ? AND state IN ('pending', 'paused')`
      )
      .run(id);
    return result.changes > 0;
  },

  /** Puts a paused row back to waiting, with its content rewritten when an edit is saved. */
  resume(id: string, edit?: { content: string; options: unknown }): boolean {
    const db = getConnection();
    const result = edit
      ? db
        .prepare(
          `UPDATE scheduled_messages SET state = 'pending', content = ?, options = ?
           WHERE id = ? AND state = 'paused'`
        )
        .run(edit.content, serializeOptions(edit.options), id)
      : db
        .prepare(`UPDATE scheduled_messages SET state = 'pending' WHERE id = ? AND state = 'paused'`)
        .run(id);
    return result.changes > 0;
  },

  /** Records that a usage reset passed while the row was paused. */
  markResetMissed(id: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE scheduled_messages SET reset_missed = 1 WHERE id = ? AND state = 'paused'`
    ).run(id);
  },

  /**
   * Records that a claimed row's send did not go through.
   *
   * Only a row this process already claimed (moved to 'sent') can be failed,
   * so a late failure cannot overwrite a row someone else cancelled.
   */
  markFailed(id: string, reason: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = 'failed', failure_reason = ?
         WHERE id = ? AND state = 'sent'`
      )
      .run(reason, id);
    return result.changes > 0;
  },

  /** Drops terminal rows older than the cutoff so the table cannot grow without bound. */
  pruneSettledBefore(isoCutoff: string): number {
    const db = getConnection();
    const result = db
      .prepare(
        `DELETE FROM scheduled_messages
         WHERE state NOT IN ('pending', 'paused') AND fired_at IS NOT NULL AND fired_at < ?`
      )
      .run(isoCutoff);
    return result.changes;
  },
};
