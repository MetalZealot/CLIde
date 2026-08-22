import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebarWidth';

/** Matches the collapsed-to-expanded default the sidebar shipped with. */
export const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 480;

export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

const readStoredWidth = (): number => {
  if (typeof window === 'undefined') {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
};

/**
 * Desktop sidebar width, remembered per browser.
 *
 * Its own storage key rather than `useUiPreferences`, which coerces every value
 * through a boolean parser.
 */
export function useSidebarWidth() {
  const [width, setWidthState] = useState<number>(readStoredWidth);

  const setWidth = useCallback((next: number) => {
    setWidthState(clampSidebarWidth(next));
  }, []);

  const resetWidth = useCallback(() => setWidthState(SIDEBAR_DEFAULT_WIDTH), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  return { width, setWidth, resetWidth };
}

export default useSidebarWidth;
