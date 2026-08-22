import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ChatReadingSize = 'compact' | 'default' | 'large';

export type AppearancePreferences = {
  version: 1;
  theme: ThemePreference;
  chatReadingSize: ChatReadingSize;
};

type AppearancePreferencesContextValue = AppearancePreferences & {
  isDarkMode: boolean;
  setTheme: (theme: ThemePreference) => void;
  setChatReadingSize: (size: ChatReadingSize) => void;
  toggleDarkMode: () => void;
};

export const APPEARANCE_STORAGE_KEY = 'appearancePreferences';
const LEGACY_THEME_STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  version: 1,
  theme: 'system',
  chatReadingSize: 'default',
};

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

const isChatReadingSize = (value: unknown): value is ChatReadingSize =>
  value === 'compact' || value === 'default' || value === 'large';

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
    version: 1,
    theme: isThemePreference(stored.theme) ? stored.theme : legacyTheme,
    chatReadingSize: isChatReadingSize(stored.chatReadingSize)
      ? stored.chatReadingSize
      : DEFAULT_APPEARANCE_PREFERENCES.chatReadingSize,
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

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    statusBarMeta?.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    themeColorMeta?.setAttribute('content', isDarkMode ? '#141414' : '#f6f4ef');
  }, [isDarkMode, preferences.chatReadingSize]);

  useEffect(() => {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Private mode or full storage still permits an in-memory preference.
    }
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

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
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

  const toggleDarkMode = useCallback(() => {
    setTheme(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setTheme]);

  const value = useMemo<AppearancePreferencesContextValue>(() => ({
    ...preferences,
    isDarkMode,
    setTheme,
    setChatReadingSize,
    toggleDarkMode,
  }), [isDarkMode, preferences, setChatReadingSize, setTheme, toggleDarkMode]);

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
