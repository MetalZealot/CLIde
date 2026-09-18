import { useCallback, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';

export type SideQuestionEntry = {
  id: string;
  question: string;
  status: 'pending' | 'answered' | 'failed';
  answer?: string;
  fallbackNotice?: string | null;
  error?: string;
};

type AskOptions = {
  provider: LLMProvider;
  sessionId: string | null;
  cwd?: string | null;
};

/**
 * Side questions live only in this hook: closing the sheet drops every entry,
 * matching the promise that nothing is stored anywhere else.
 */
export function useSideQuestion() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SideQuestionEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((id: string, patch: Partial<SideQuestionEntry>) => {
    setEntries((current) => current.map((entry) => (
      entry.id === id ? { ...entry, ...patch } : entry
    )));
  }, []);

  const ask = useCallback(async (question: string, options: AskOptions) => {
    const trimmed = question.trim();
    if (!trimmed) {
      setOpen(true);
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setEntries((current) => [...current, { id, question: trimmed, status: 'pending' }]);
    setOpen(true);

    if (!options.sessionId) {
      update(id, { status: 'failed', error: 'Start the conversation before asking a side question.' });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authenticatedFetch(
        `/api/providers/${options.provider}/sessions/${encodeURIComponent(options.sessionId)}/side-question`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed, cwd: options.cwd || null }),
          signal: controller.signal,
        },
      );
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message || payload?.error || 'That side question could not be answered.');
      }

      update(id, {
        status: 'answered',
        answer: payload?.data?.answer || '',
        fallbackNotice: payload?.data?.fallbackNotice || null,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      update(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'That side question could not be answered.',
      });
    }
  }, [update]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setEntries([]);
  }, []);

  return { open, entries, ask, close };
}
