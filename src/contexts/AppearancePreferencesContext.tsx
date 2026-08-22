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

export const APPEARANCE_STORAGE_KEY = 'appearancePreferences';
const LEGACY_THEME_STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

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
