/**
 * Models starred in the model picker. Synced per user, so a star set on the
 * phone shows on the laptop. Storage stays localStorage; this adds the read,
 * write and change reporting that the preference sync needs.
 */

import { useCallback, useEffect, useState } from 'react';

import type { SyncedPreferences } from '../../shared/synced-preferences';
import type { LLMProvider } from '../types/app';

export type FavoriteModel = { provider: LLMProvider; model: string };

const STORAGE_KEY = 'favoriteModels';
const SYNC_EVENT = 'favorite-models:sync';

type SyncEventDetail = { fromServer: boolean; value: FavoriteModel[] };

const isFavoriteModel = (value: unknown): value is FavoriteModel => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.provider === 'string' && typeof entry.model === 'string';
};

const parseFavorites = (value: unknown): FavoriteModel[] | null => (
  Array.isArray(value) ? value.filter(isFavoriteModel) : null
);

const readStored = (): FavoriteModel[] | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseFavorites(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeFavorites = (favorites: FavoriteModel[], fromServer: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // The dispatched event still updates a mounted picker.
  }
  window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
    detail: { fromServer, value: favorites },
  }));
};

/** The favourites this browser has stored, omitted when it has never saved any. */
export const readStoredFavoriteModels = (): SyncedPreferences => {
  const stored = readStored();
  return stored ? { [STORAGE_KEY]: stored } : {};
};

/** Applies favourites that arrived from the server without reporting them back. */
export const applyRemoteFavoriteModels = (preferences: SyncedPreferences): void => {
  if (!(STORAGE_KEY in preferences)) return;
  const favorites = parseFavorites(preferences[STORAGE_KEY]);
  if (favorites) writeFavorites(favorites, true);
};

/** Reports favourites changed in this browser, in the shape the server stores. */
export const subscribeToFavoriteModels = (
  listener: (changes: SyncedPreferences) => void,
): (() => void) => {
  const handleSyncEvent = (event: Event) => {
    const detail = (event as CustomEvent<SyncEventDetail>).detail;
    if (!detail || detail.fromServer) return;
    listener({ [STORAGE_KEY]: detail.value });
  };

  window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
  return () => window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
};

const sameFavorite = (left: FavoriteModel, right: FavoriteModel) =>
  left.provider === right.provider && left.model === right.model;

/** Starred models in the order they were starred, kept live across tabs and devices. */
export function useFavoriteModels() {
  const [favorites, setFavorites] = useState<FavoriteModel[]>(() => readStored() ?? []);

  useEffect(() => {
    const handleSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (detail) setFavorites(detail.value);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setFavorites(readStored() ?? []);
    };

    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const isFavorite = useCallback(
    (provider: LLMProvider, model: string) => favorites.some((entry) => sameFavorite(entry, { provider, model })),
    [favorites],
  );

  const toggleFavorite = useCallback((provider: LLMProvider, model: string) => {
    const target = { provider, model };
    const current = readStored() ?? [];
    const next = current.some((entry) => sameFavorite(entry, target))
      ? current.filter((entry) => !sameFavorite(entry, target))
      : [...current, target];
    writeFavorites(next, false);
  }, []);

  return { favorites, isFavorite, toggleFavorite };
}
