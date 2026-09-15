import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type ScheduledMessageTrigger = 'time' | 'usage-reset';
export type ScheduledMessageState = 'pending' | 'sent' | 'cancelled' | 'failed';

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
  held_by: string | null;
  /** Epoch ms; the row is held only while this is in the future. */
  held_until: number | null;
  reset_missed: number;
};

const COLUMNS =
  'id, session_id, provider, content, options, trigger_kind, scheduled_for, state, failure_reason, created_at, fired_at, held_by, held_until, reset_missed';

export type CreateScheduledMessageInput = {
  sessionId: string;
  provider: string;
  content: string;
  options?: unknown;
  trigger: ScheduledMessageTrigger;
  /** ISO instant; required for a 'time' trigger and ignored for 'usage-reset'. */
  scheduledFor?: string | null;
};

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
      input.options === undefined ? null : JSON.stringify(input.options),
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

  /** Pending rows waiting on one provider's usage reset, oldest first. */
  listPendingForUsageReset(provider: string): ScheduledMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE state = 'pending' AND trigger_kind = 'usage-reset' AND provider = ?
         ORDER BY created_at ASC`
      )
      .all(provider) as ScheduledMessageRow[];
  },

  listBySession(sessionId: string): ScheduledMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE session_id = ?
         ORDER BY created_at DESC`
      )
      .all(sessionId) as ScheduledMessageRow[];
  },

  /** Session ids with at least one pending message, for the sidebar status column. */
  listSessionIdsWithPending(): string[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT DISTINCT session_id FROM scheduled_messages WHERE state = 'pending'`
      )
      .all() as { session_id: string }[];
    return rows.map((row) => row.session_id);
  },

  /**
   * Moves a row out of 'pending', and only from 'pending'.
   *
   * The guard is what makes firing safe to attempt twice: a dispatcher timer
   * and a startup sweep can race for the same row, and the loser writes
   * nothing. Returns whether this caller is the one that claimed it.
   */
  settle(id: string, state: Exclude<ScheduledMessageState, 'pending'>, failureReason?: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = ?, failure_reason = ?, fired_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state = 'pending'`
      )
      .run(state, failureReason ?? null, id);
    return result.changes > 0;
  },

  /**
   * Claims a pending row for sending, unless an editor holds it.
   *
   * The same one-statement claim as `settle`, with the lease as a second guard,
   * so a row held for editing cannot fire however the dispatcher reached it.
   */
  claimForSend(id: string, nowMs: number): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages
         SET state = 'sent', fired_at = CURRENT_TIMESTAMP, held_until = NULL
         WHERE id = ? AND state = 'pending' AND (held_until IS NULL OR held_until <= ?)`
      )
      .run(id, nowMs);
    return result.changes > 0;
  },

  /**
   * Holds a pending row for a new editor, taking it from any earlier one.
   *
   * The newest editor wins: moving between devices mid-edit must not lock the
   * message for a lease length. The earlier editor's token stops matching, so
   * its renew, release, and save all fail rather than overwrite this edit.
   */
  hold(id: string, token: string, heldUntilMs: number): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages SET held_by = ?, held_until = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(token, heldUntilMs, id);
    return result.changes > 0;
  },

  /** Extends this editor's lease, re-taking one that lapsed if nobody else took it. */
  renewHold(id: string, token: string, heldUntilMs: number): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages SET held_until = ?
         WHERE id = ? AND state = 'pending' AND held_by = ?`
      )
      .run(heldUntilMs, id, token);
    return result.changes > 0;
  },

  /** Ends this editor's lease without changing the message. */
  releaseHold(id: string, token: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages SET held_until = NULL
         WHERE id = ? AND state = 'pending' AND held_by = ?`
      )
      .run(id, token);
    return result.changes > 0;
  },

  /** Saves this editor's rewrite and ends its lease in one statement. */
  saveEdit(id: string, token: string, content: string, options: unknown): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE scheduled_messages SET content = ?, options = ?, held_until = NULL
         WHERE id = ? AND state = 'pending' AND held_by = ?`
      )
      .run(content, options === undefined ? null : JSON.stringify(options), id, token);
    return result.changes > 0;
  },

  /** Records that a usage reset passed while the row was held. */
  markResetMissed(id: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE scheduled_messages SET reset_missed = 1 WHERE id = ? AND state = 'pending'`
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
         WHERE state <> 'pending' AND fired_at IS NOT NULL AND fired_at < ?`
      )
      .run(isoCutoff);
    return result.changes;
  },
};
