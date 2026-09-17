/**
 * User preferences repository.
 *
 * One row per user and preference key, each value stored as JSON. Writing a
 * null value deletes the row, so a client that resets a preference to its
 * default leaves nothing behind for the next device to inherit.
 */

import { getConnection } from '@/modules/database/connection.js';

type PreferenceRow = { key: string; value_json: string };

export const userPreferencesDb = {
  /** Returns every stored preference for a user, keyed by preference name. */
  getPreferences(userId: number): Record<string, unknown> {
    const db = getConnection();
    const rows = db
      .prepare('SELECT key, value_json FROM user_preferences WHERE user_id = ?')
      .all(userId) as PreferenceRow[];

    const preferences: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        preferences[row.key] = JSON.parse(row.value_json);
      } catch {
        // A malformed row reads as absent rather than breaking the whole load.
      }
    }
    return preferences;
  },

  /** Upserts each entry, deleting the row for any entry whose value is null. */
  setPreferences(userId: number, entries: Record<string, unknown>): void {
    const db = getConnection();
    const upsert = db.prepare(
      `INSERT INTO user_preferences (user_id, key, value_json, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`
    );
    const remove = db.prepare('DELETE FROM user_preferences WHERE user_id = ? AND key = ?');

    db.transaction(() => {
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) {
          remove.run(userId, key);
        } else {
          upsert.run(userId, key, JSON.stringify(value));
        }
      }
    })();
  },
};
