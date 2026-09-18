/**
 * The per-provider tool permission settings, which follow the user between
 * devices: what a provider may run without asking is a decision about the
 * agent, not about the browser it was made in.
 *
 * Storage stays localStorage — this only adds the read, write and change
 * reporting that the preference sync needs.
 */

import type { SyncedPreferences } from '../../shared/synced-preferences';

export const PROVIDER_TOOL_SETTINGS_KEYS = [
  'claude-settings',
  'cursor-tools-settings',
  'codex-settings',
] as const;

export type ProviderToolSettingsKey = (typeof PROVIDER_TOOL_SETTINGS_KEYS)[number];

const SYNC_EVENT = 'provider-tool-settings:sync';

type SyncEventDetail = {
  fromServer: boolean;
  value: SyncedPreferences;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const announce = (detail: SyncEventDetail): void => {
  window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, { detail }));
};

const writeSettings = (entries: SyncedPreferences, fromServer: boolean): void => {
  if (typeof window === 'undefined') return;

  const written: SyncedPreferences = {};
  for (const key of PROVIDER_TOOL_SETTINGS_KEYS) {
    if (!(key in entries)) continue;
    const value = entries[key];
    if (!isRecord(value)) continue;

    written[key] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The dispatched event still reaches a live settings screen.
    }
  }

  if (Object.keys(written).length > 0) announce({ fromServer, value: written });
};

/** The provider settings this browser has stored, omitting any it has never saved. */
export const readProviderToolSettings = (): SyncedPreferences => {
  if (typeof window === 'undefined') return {};

  const settings: SyncedPreferences = {};
  for (const key of PROVIDER_TOOL_SETTINGS_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) settings[key] = parsed;
    } catch {
      // A malformed entry reads as never saved.
    }
  }
  return settings;
};

/** Saves settings changed in this browser, and reports them for syncing. */
export const saveProviderToolSettings = (entries: SyncedPreferences): void => {
  writeSettings(entries, false);
};

/** Applies settings that arrived from the server without reporting them back. */
export const applyRemoteProviderToolSettings = (preferences: SyncedPreferences): void => {
  writeSettings(preferences, true);
};

/** Reports settings saved in this browser, in the shape the server stores. */
export const subscribeToProviderToolSettings = (
  listener: (changes: SyncedPreferences) => void,
): (() => void) => {
  const handleSyncEvent = (event: Event) => {
    const detail = (event as CustomEvent<SyncEventDetail>).detail;
    if (!detail || detail.fromServer) return;
    listener(detail.value);
  };

  window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
  return () => window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
};
