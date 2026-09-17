/**
 * Client preferences the server mirrors per user so they survive a browser or
 * device change. Everything else in localStorage stays per-browser on purpose
 * (window geometry, the active tab, per-device model picks).
 *
 * Keys are the localStorage key names, so moving another preference onto the
 * server is a one-line addition here plus a client that reports its changes.
 */
export const SYNCED_PREFERENCE_KEYS = [
  'thinkingMessages',
  'thinkingMessageCycle',
  'thinkingMessageOrder',
] as const;

export type SyncedPreferenceKey = (typeof SYNCED_PREFERENCE_KEYS)[number];

export type SyncedPreferences = Partial<Record<SyncedPreferenceKey, unknown>>;

/** Per-value ceiling; the largest synced value today is 24 messages of 80 chars. */
export const MAX_SYNCED_PREFERENCE_BYTES = 8192;

export const isSyncedPreferenceKey = (value: unknown): value is SyncedPreferenceKey =>
  typeof value === 'string'
  && (SYNCED_PREFERENCE_KEYS as readonly string[]).includes(value);
