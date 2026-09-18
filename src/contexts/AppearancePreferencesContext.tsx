import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ChatReadingSize = 'smallest' | 'small' | 'default' | 'large';
export type ChatLineSpacing = 'condensed' | 'standard' | 'relaxed' | 'spacious';
export type FontFamilyPreference = 'clide' | 'system';

export type AppearancePreferences = {
  version: 3;
  theme: ThemePreference;
  chatReadingSize: ChatReadingSize;
  chatLineSpacing: ChatLineSpacing;
  fontFamily: FontFamilyPreference;
};

type AppearancePreferencesContextValue = AppearancePreferences & {
  isDarkMode: boolean;
  setTheme: (theme: ThemePreference) => void;
  setChatReadingSize: (size: ChatReadingSize) => void;
  setChatLineSpacing: (spacing: ChatLineSpacing) => void;
  setFontFamily: (fontFamily: FontFamilyPreference) => void;
  toggleDarkMode: () => void;
};

import type { SyncedPreferences } from '../../shared/synced-preferences';

export const APPEARANCE_STORAGE_KEY = 'appearancePreferences';
const LEGACY_THEME_STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const SYNC_EVENT = 'appearance-preferences:sync';

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  version: 3,
  theme: 'system',
  chatReadingSize: 'default',
  chatLineSpacing: 'standard',
  fontFamily: 'clide',
};

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

const isChatReadingSize = (value: unknown): value is ChatReadingSize =>
  value === 'smallest' || value === 'small' || value === 'default' || value === 'large';

const parseChatReadingSize = (value: unknown): ChatReadingSize => {
  if (value === 'compact') return 'smallest';
  return isChatReadingSize(value) ? value : DEFAULT_APPEARANCE_PREFERENCES.chatReadingSize;
};

const isChatLineSpacing = (value: unknown): value is ChatLineSpacing =>
  value === 'condensed' || value === 'standard' || value === 'relaxed' || value === 'spacious';

const isFontFamilyPreference = (value: unknown): value is FontFamilyPreference =>
  value === 'clide' || value === 'system';

const readLegacyTheme = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

export const parseAppearancePreferences = (
  value: unknown,
  legacyTheme: ThemePreference = 'system',
): AppearancePreferences => {
  const stored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    version: 3,
    theme: isThemePreference(stored.theme) ? stored.theme : legacyTheme,
    chatReadingSize: parseChatReadingSize(stored.chatReadingSize),
    chatLineSpacing: isChatLineSpacing(stored.chatLineSpacing)
      ? stored.chatLineSpacing
      : DEFAULT_APPEARANCE_PREFERENCES.chatLineSpacing,
    fontFamily: isFontFamilyPreference(stored.fontFamily)
      ? stored.fontFamily
      : DEFAULT_APPEARANCE_PREFERENCES.fontFamily,
  };
};

const readInitialPreferences = (): AppearancePreferences => {
  if (typeof window === 'undefined') {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }

  const legacyTheme = readLegacyTheme();
  try {
    return parseAppearancePreferences(
      JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null'),
      legacyTheme,
    );
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCES, theme: legacyTheme };
  }
};

type SyncEventDetail = {
  fromServer: boolean;
  value: Partial<AppearancePreferences>;
};

/**
 * Theme and font follow the user between devices; reading size and line spacing
 * do not, because they are set for the screen in front of you.
 */
const syncedFields = (
  preferences: Partial<AppearancePreferences>,
): Partial<AppearancePreferences> => {
  const synced: Partial<AppearancePreferences> = {};
  if (isThemePreference(preferences.theme)) synced.theme = preferences.theme;
  if (isFontFamilyPreference(preferences.fontFamily)) synced.fontFamily = preferences.fontFamily;
  return synced;
};

const announce = (detail: SyncEventDetail): void => {
  window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, { detail }));
};

/** The synced appearance fields this browser has stored, or nothing if it has none. */
export const readSyncedAppearancePreferences = (): SyncedPreferences => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw === null) return {};
    return { [APPEARANCE_STORAGE_KEY]: syncedFields(parseAppearancePreferences(JSON.parse(raw))) };
  } catch {
    return {};
  }
};

/** Merges server-provided appearance fields into this browser's stored preferences. */
export const applyRemoteAppearancePreferences = (preferences: SyncedPreferences): void => {
  if (typeof window === 'undefined') return;
  if (!(APPEARANCE_STORAGE_KEY in preferences)) return;

  const incoming = preferences[APPEARANCE_STORAGE_KEY];
  const value = syncedFields(
    incoming && typeof incoming === 'object' && !Array.isArray(incoming)
      ? incoming as Partial<AppearancePreferences>
      : {},
  );
  if (Object.keys(value).length === 0) return;

  try {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...readInitialPreferences(), ...value }),
    );
  } catch {
    // The dispatched event still updates the live provider.
  }
  announce({ fromServer: true, value });
};

/** Reports locally changed appearance fields in the shape the server stores. */
export const subscribeToAppearanceChanges = (
  listener: (changes: SyncedPreferences) => void,
): (() => void) => {
  const handleSyncEvent = (event: Event) => {
    const detail = (event as CustomEvent<SyncEventDetail>).detail;
    if (!detail || detail.fromServer) return;
    listener({ [APPEARANCE_STORAGE_KEY]: detail.value });
  };

  window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
  return () => window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
};

const prefersDark = () => Boolean(
  typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia(DARK_QUERY).matches,
);

export function AppearancePreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(readInitialPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(prefersDark);
  const isDarkMode = preferences.theme === 'system'
    ? systemPrefersDark
    : preferences.theme === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    root.dataset.chatReadingSize = preferences.chatReadingSize;
    root.dataset.chatLineSpacing = preferences.chatLineSpacing;
    root.dataset.fontFamily = preferences.fontFamily;

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    statusBarMeta?.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    themeColorMeta?.setAttribute('content', isDarkMode ? '#141414' : '#f6f4ef');
  }, [isDarkMode, preferences.chatLineSpacing, preferences.chatReadingSize, preferences.fontFamily]);

  useEffect(() => {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Private mode or full storage still permits an in-memory preference.
    }

    announce({ fromServer: false, value: syncedFields(preferences) });
  }, [preferences]);

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY || event.newValue === null) return;

      try {
        setPreferences(parseAppearancePreferences(JSON.parse(event.newValue), readLegacyTheme()));
      } catch {
        // Ignore malformed writes from another tab.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (!detail?.fromServer) return;
      setPreferences((current) => ({ ...current, ...detail.value }));
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, []);

  const setTheme = useCallback((theme: ThemePreference) => {
    if (!isThemePreference(theme)) return;
    setPreferences((current) => current.theme === theme ? current : { ...current, theme });
  }, []);

  const setChatReadingSize = useCallback((chatReadingSize: ChatReadingSize) => {
    if (!isChatReadingSize(chatReadingSize)) return;
    setPreferences((current) => current.chatReadingSize === chatReadingSize
      ? current
      : { ...current, chatReadingSize });
  }, []);

  const setChatLineSpacing = useCallback((chatLineSpacing: ChatLineSpacing) => {
    if (!isChatLineSpacing(chatLineSpacing)) return;
    setPreferences((current) => current.chatLineSpacing === chatLineSpacing
      ? current
      : { ...current, chatLineSpacing });
  }, []);

  const setFontFamily = useCallback((fontFamily: FontFamilyPreference) => {
    if (!isFontFamilyPreference(fontFamily)) return;
    setPreferences((current) => current.fontFamily === fontFamily
      ? current
      : { ...current, fontFamily });
  }, []);

  const toggleDarkMode = useCallback(() => {
    setTheme(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setTheme]);

  const value = useMemo<AppearancePreferencesContextValue>(() => ({
    ...preferences,
    isDarkMode,
    setTheme,
    setChatReadingSize,
    setChatLineSpacing,
    setFontFamily,
    toggleDarkMode,
  }), [
    isDarkMode,
    preferences,
    setChatLineSpacing,
    setChatReadingSize,
    setFontFamily,
    setTheme,
    toggleDarkMode,
  ]);

  return (
    <AppearancePreferencesContext.Provider value={value}>
      {children}
    </AppearancePreferencesContext.Provider>
  );
}

export const useAppearancePreferences = (): AppearancePreferencesContextValue => {
  const context = useContext(AppearancePreferencesContext);
  if (!context) {
    throw new Error('useAppearancePreferences must be used within AppearancePreferencesProvider');
  }
  return context;
};

export const useTheme = () => {
  const { theme, setTheme, isDarkMode, toggleDarkMode } = useAppearancePreferences();
  return { theme, setTheme, isDarkMode, toggleDarkMode };
};
