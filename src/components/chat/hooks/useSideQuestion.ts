import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';

export type SideQuestionEntry = {
  id: string;
  question: string;
  status: 'pending' | 'answered' | 'failed';
  answer?: string;
  fallbackNotice?: string | null;
  error?: string;
  askedAt: string;
};

/** The session a forked side question became. */
export type SideQuestionFork = {
  sessionId: string;
  provider?: LLMProvider;
  summary?: string | null;
};

type SideQuestionTarget = {
  provider: LLMProvider;
  sessionId: string | null;
  cwd?: string | null;
};

const PENDING_REFRESH_MS = 2000;

const readEntries = (payload: unknown): SideQuestionEntry[] | null => {
  const entries = (payload as { data?: { entries?: unknown } } | null)?.data?.entries;
  return Array.isArray(entries) ? entries as SideQuestionEntry[] : null;
};

/** A question sent from this tab shows once, whichever list has it. */
export function mergeSideQuestionEntries(
  serverEntries: SideQuestionEntry[],
  sending: SideQuestionEntry[],
): SideQuestionEntry[] {
  const pendingOnServer = new Set(
    serverEntries.filter((entry) => entry.status === 'pending').map((entry) => entry.question),
  );
  return [
    ...serverEntries,
    ...sending.filter((entry) => entry.status === 'failed' || !pendingOnServer.has(entry.question)),
  ];
}

/**
 * The session's side-question history lives on the server, so this hook only
 * mirrors it. Closing the sheet hides it; Clear is the only thing that discards.
 */
export function useSideQuestion({ provider, sessionId, cwd }: SideQuestionTarget) {
  const [open, setOpen] = useState(false);
  const [serverEntries, setServerEntries] = useState<SideQuestionEntry[]>([]);
  // Questions this tab sent whose POST has not come back; the server list takes over once it has them.
  const [sending, setSending] = useState<SideQuestionEntry[]>([]);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const endpoint = sessionId
    ? `/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/side-questions`
    : null;

  const refresh = useCallback(async () => {
    if (!endpoint) {
      return;
    }
    const requestedFor = sessionRef.current;
    try {
      const response = await authenticatedFetch(endpoint);
      const entries = readEntries(await response.json());
      if (entries && sessionRef.current === requestedFor) {
        setServerEntries(entries);
      }
    } catch {
      // A missed refresh is retried by the pending poll or the next open.
    }
  }, [endpoint]);

  useEffect(() => {
    setOpen(false);
    setServerEntries([]);
    setSending([]);
  }, [sessionId]);

  const openSheet = useCallback(() => {
    setOpen(true);
    void refresh();
  }, [refresh]);

  const hasPending = serverEntries.some((entry) => entry.status === 'pending');
  useEffect(() => {
    if (!open || !hasPending) {
      return undefined;
    }
    const timer = window.setInterval(() => void refresh(), PENDING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, hasPending, refresh]);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim();
    setOpen(true);
    if (!trimmed) {
      void refresh();
      return;
    }

    const local: SideQuestionEntry = {
      id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      question: trimmed,
      status: 'pending',
      askedAt: new Date().toISOString(),
    };
    if (!endpoint) {
      setSending((current) => [...current, {
        ...local,
        status: 'failed',
        error: 'Start the conversation before asking a side question.',
      }]);
      return;
    }

    setSending((current) => [...current, local]);
    const requestedFor = sessionRef.current;
    try {
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, cwd: cwd || null }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message || payload?.error || 'That side question could not be answered.');
      }
      if (sessionRef.current !== requestedFor) {
        return;
      }
      const entries = readEntries(payload);
      if (entries) {
        setServerEntries(entries);
      }
      setSending((current) => current.filter((entry) => entry.id !== local.id));
    } catch (error) {
      if (sessionRef.current !== requestedFor) {
        return;
      }
      setSending((current) => current.map((entry) => (entry.id === local.id
        ? { ...entry, status: 'failed', error: error instanceof Error ? error.message : 'That side question could not be answered.' }
        : entry)));
    }
  }, [cwd, endpoint, refresh]);

  const clear = useCallback(async () => {
    setServerEntries([]);
    setSending([]);
    if (!endpoint) {
      return;
    }
    try {
      await authenticatedFetch(endpoint, { method: 'DELETE' });
    } catch {
      void refresh();
    }
  }, [endpoint, refresh]);

  const close = useCallback(() => setOpen(false), []);

  const fork = useCallback(async (entryId: string): Promise<SideQuestionFork> => {
    if (!endpoint) {
      throw new Error('Start the conversation before forking a side question.');
    }
    const response = await authenticatedFetch(`${endpoint}/${encodeURIComponent(entryId)}/fork`, {
      method: 'POST',
    });
    const payload = await response.json();
    if (!response.ok || !payload?.data?.sessionId) {
      throw new Error(payload?.error?.message || payload?.error || 'That side question could not be forked.');
    }
    return payload.data as SideQuestionFork;
  }, [endpoint]);

  const entries = useMemo(() => mergeSideQuestionEntries(serverEntries, sending), [sending, serverEntries]);

  return { open, entries, ask, openSheet, close, clear, fork };
}
