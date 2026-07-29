import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

type GitConfigResponse = {
  gitName?: string;
  gitEmail?: string;
  error?: string;
};

type SaveStatus = 'success' | 'error' | null;

const BLUR_SAVE_DEBOUNCE_MS = 300;
const SAVE_STATUS_CLEAR_MS = 2000;

/**
 * Save-on-blur, debounced: git config writes are real `git config --global`
 * calls, so nothing here fires per keystroke. Blurring either field schedules
 * a save; blurring straight from name into email coalesces into one write
 * instead of firing twice, since both fields go in a single request.
 */
export function useGitSettings() {
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);

  const lastSavedRef = useRef({ gitName: '', gitEmail: '' });
  const blurTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  // Mirror the latest field values: the debounced callback is scheduled from
  // onBlur and would otherwise close over the state at blur time, not whatever
  // the other field settles on before the timer fires.
  const gitNameRef = useRef(gitName);
  const gitEmailRef = useRef(gitEmail);
  gitNameRef.current = gitName;
  gitEmailRef.current = gitEmail;

  const loadGitConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch('/api/user/git-config');
      if (!response.ok) {
        return;
      }

      const data = await response.json() as GitConfigResponse;
      const name = data.gitName || '';
      const email = data.gitEmail || '';
      setGitName(name);
      setGitEmail(email);
      lastSavedRef.current = { gitName: name, gitEmail: email };
    } catch (error) {
      console.error('Error loading git config:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const flushSave = useCallback(async () => {
    const name = gitNameRef.current.trim();
    const email = gitEmailRef.current.trim();

    // Validation before write: never send a half-filled identity to git config.
    if (!name || !email) {
      return;
    }
    if (name === lastSavedRef.current.gitName && email === lastSavedRef.current.gitEmail) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitName: name, gitEmail: email }),
      });

      if (response.ok) {
        lastSavedRef.current = { gitName: name, gitEmail: email };
        setSaveStatus('success');
      } else {
        const data = await response.json() as GitConfigResponse;
        console.error('Failed to save git config:', data.error);
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Error saving git config:', error);
      setSaveStatus('error');
    }

    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setSaveStatus(null);
      statusTimerRef.current = null;
    }, SAVE_STATUS_CLEAR_MS);
  }, []);

  const handleFieldBlur = useCallback(() => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
    }
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = null;
      void flushSave();
    }, BLUR_SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    void loadGitConfig();
  }, [loadGitConfig]);

  useEffect(() => () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
    }
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
  }, []);

  return {
    gitName,
    setGitName,
    gitEmail,
    setGitEmail,
    isLoading,
    saveStatus,
    handleFieldBlur,
  };
}
