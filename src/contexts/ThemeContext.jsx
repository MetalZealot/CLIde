import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext();

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const prefersDark = () => Boolean(window.matchMedia && window.matchMedia(DARK_QUERY).matches);

// A missing key means "follow the system", which is also the first-run state.
// Anything unrecognised is treated the same way rather than trusted.
const readStoredTheme = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(prefersDark);

  const isDarkMode = theme === 'system' ? systemPrefersDark : theme === 'dark';

  // Apply the resolved theme to the document. This deliberately does NOT write
  // localStorage: writing on mount is what used to kill system-following on the
  // very first page load, before the user had touched anything.
  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Keep the iOS status bar style and PWA theme colour in step.
    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      // Dark background hsl(0 0% 8%) / light background warm cream.
      themeColorMeta.setAttribute('content', isDarkMode ? '#141414' : '#f6f4ef');
    }
  }, [isDarkMode]);

  // Stays subscribed for the whole session; the value only feeds through while
  // the preference is 'system', so returning to 'system' resumes following.
  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (event) => setSystemPrefersDark(event.matches);

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return;

    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode or storage full — the in-memory preference still applies */
    }
  }, []);

  // Two-state toggle over a three-state value: flips the currently resolved
  // appearance and, as a side effect, moves off 'system'. Kept for the callers
  // outside Settings (DarkModeToggle, the command palette).
  const toggleDarkMode = useCallback(() => {
    setTheme(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setTheme]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    isDarkMode,
    toggleDarkMode,
  }), [isDarkMode, setTheme, theme, toggleDarkMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
