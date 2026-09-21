import { useCallback, useEffect, useState } from 'react';

import { fetchAutoContinueDefault, saveAutoContinueDefault } from '../../../utils/autoContinue';

/**
 * The standing Auto-Continue mode new chats start in. The switch moves at once
 * and returns to where it was if the write fails, so what it shows is always
 * what the server holds.
 */
export function useAutoContinueDefault() {
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchAutoContinueDefault().then((stored) => {
      if (cancelled) return;
      setEnabled(stored);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    void saveAutoContinueDefault(next).then((saved) => {
      setEnabled(saved === null ? !next : saved);
    });
  }, []);

  return { enabled, isLoading, toggle };
}
