/**
 * Client preferences the server mirrors per user so they survive a browser or
 * device change. Everything else in localStorage stays per-browser on purpose
 * (window geometry, the active tab, per-device model picks).
 *
 * Keys are the localStorage key names, so moving another preference onto the
 * server is a one-line addition here plus a client that reports its changes.
 */
export const SYNCED_PREFERENCE_KEYS = [
  // Theme and font only; reading size and line spacing stay per device, where
  // screen size is the reason they were set.
  'appearancePreferences',
  'claude-settings',
  'cursor-tools-settings',
  'codex-settings',
  'favoriteModels',
] as const;

export type SyncedPreferenceKey = (typeof SYNCED_PREFERENCE_KEYS)[number];

export type SyncedPreferences = Partial<Record<SyncedPreferenceKey, unknown>>;

/** Per-value ceiling, sized for the largest value: a provider's tool allowlists. */
export const MAX_SYNCED_PREFERENCE_BYTES = 8192;

export const isSyncedPreferenceKey = (value: unknown): value is SyncedPreferenceKey =>
  typeof value === 'string'
  && (SYNCED_PREFERENCE_KEYS as readonly string[]).includes(value);
