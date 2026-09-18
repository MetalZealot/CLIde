import { useEffect, useRef } from 'react';

import type { SyncedPreferences } from '../../shared/synced-preferences';
import {
  applyRemoteAppearancePreferences,
  readSyncedAppearancePreferences,
  subscribeToAppearanceChanges,
} from '../contexts/AppearancePreferencesContext';
import { api } from '../utils/api';
import {
  applyRemoteProviderToolSettings,
  readProviderToolSettings,
  subscribeToProviderToolSettings,
} from '../utils/providerToolSettings';

import {
  applyRemoteThinkingPreferences,
  readStoredThinkingPreferences,
  subscribeToThinkingPreferenceChanges,
} from './useThinkingMessages';

/**
 * Each synced preference family owns reading its stored values, applying the
 * server's, and reporting local edits. Adding a family is an entry here plus an
 * allowlisted key.
 */
type PreferenceSource = {
  read: () => SyncedPreferences;
  apply: (preferences: SyncedPreferences) => void;
  subscribe: (listener: (changes: SyncedPreferences) => void) => () => void;
};

const SOURCES: PreferenceSource[] = [
  {
    read: readStoredThinkingPreferences,
    apply: applyRemoteThinkingPreferences,
    subscribe: subscribeToThinkingPreferenceChanges,
  },
  {
    read: readSyncedAppearancePreferences,
    apply: applyRemoteAppearancePreferences,
    subscribe: subscribeToAppearanceChanges,
  },
  {
    read: readProviderToolSettings,
    apply: applyRemoteProviderToolSettings,
    subscribe: subscribeToProviderToolSettings,
  },
];

// Long enough that typing a message list or tapping through cycle options
// settles into one request, short enough to survive closing the tab after.
const WRITE_DEBOUNCE_MS = 600;

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * Mirrors the synced preferences through the server so a new browser or device
 * inherits them instead of starting at the defaults. The server's copy wins at
 * load; after that the most recent write wins, which is the only resolution a
 * single user switching devices needs.
 *
 * Mount once, inside the authenticated tree.
 */
export function useSyncedPreferences(): void {
  const serverState = useRef<SyncedPreferences>({});
  const pending = useRef<SyncedPreferences>({});
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
      const changes = pending.current;
      if (Object.keys(changes).length === 0) return;

      try {
        const response = await api.put('/settings/preferences', { preferences: changes });
        if (!response.ok) return;
        const body = await response.json();
        if (cancelled) return;
        serverState.current = body?.preferences ?? serverState.current;
        // Only drop the entries this request carried; a later edit may have queued.
        for (const key of Object.keys(changes)) {
          if (sameValue(pending.current[key as keyof SyncedPreferences], changes[key as keyof SyncedPreferences])) {
            delete pending.current[key as keyof SyncedPreferences];
          }
        }
      } catch {
        // Keep the entry queued; the next change retries it.
      }
    };

    const queue = (changes: SyncedPreferences) => {
      if (!hydrated.current) return;

      for (const [key, value] of Object.entries(changes)) {
        const preferenceKey = key as keyof SyncedPreferences;
        if (sameValue(serverState.current[preferenceKey], value)) {
          delete pending.current[preferenceKey];
          continue;
        }
        pending.current[preferenceKey] = value;
      }

      if (Object.keys(pending.current).length === 0) return;
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => { void flush(); }, WRITE_DEBOUNCE_MS);
    };

    // Backgrounding a mobile browser can end the tab before the debounce fires.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      if (writeTimer) clearTimeout(writeTimer);
      void flush();
    };

    const unsubscribes = SOURCES.map((source) => source.subscribe(queue));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void (async () => {
      const stored = Object.assign({}, ...SOURCES.map((source) => source.read())) as SyncedPreferences;
      try {
        const response = await api.get('/settings/preferences');
        if (response.ok) {
          const body = await response.json();
          if (cancelled) return;
          serverState.current = body?.preferences ?? {};
          if (Object.keys(serverState.current).length > 0) {
            for (const source of SOURCES) source.apply(serverState.current);
          }
        }
      } catch {
        // Offline: this browser's stored values stay in force and seed the
        // server on the next successful write.
      }

      if (cancelled) return;
      hydrated.current = true;
      // A browser holding values the server has never seen seeds them.
      const unseeded = Object.fromEntries(
        Object.entries(stored).filter(([key]) => !(key in serverState.current)),
      );
      if (Object.keys(unseeded).length > 0) queue(unseeded);
    })();

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (writeTimer) clearTimeout(writeTimer);
    };
  }, []);
}
