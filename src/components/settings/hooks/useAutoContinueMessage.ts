import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_AUTO_CONTINUE_MESSAGE,
  fetchAutoContinueMessage,
  saveAutoContinueMessage,
} from '../../../utils/autoContinue';

type SaveStatus = 'success' | 'error' | null;

const SAVE_STATUS_CLEAR_MS = 2000;

/**
 * The Auto-Continue message, saved on blur: it lives on the server, so nothing
 * here writes per keystroke. Clearing the field stores nothing and the default
 * comes back, which is why a blank value is saved rather than rejected.
 */
export function useAutoContinueMessage() {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const lastSavedRef = useRef('');
  const statusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAutoContinueMessage().then((stored) => {
      if (cancelled) return;
      setMessage(stored);
      lastSavedRef.current = stored;
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleBlur = useCallback(() => {
    const next = message.trim();
    if (next === lastSavedRef.current.trim()) return;

    void saveAutoContinueMessage(next).then((saved) => {
      if (saved === null) {
        setSaveStatus('error');
      } else {
        // A cleared field comes back as the default, so show what will send.
        setMessage(saved);
        lastSavedRef.current = saved;
        setSaveStatus('success');
      }
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => {
        setSaveStatus(null);
        statusTimerRef.current = null;
      }, SAVE_STATUS_CLEAR_MS);
    });
  }, [message]);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
  }, []);

  return {
    message,
    setMessage,
    defaultMessage: DEFAULT_AUTO_CONTINUE_MESSAGE,
    isLoading,
    saveStatus,
    handleBlur,
  };
}
