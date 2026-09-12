import { useEffect, useState } from 'react';

import type { BrowserSessionSummary } from '../../../shared/browser-use';
import { authenticatedFetch } from '../../utils/api';

type BrowserState = { chatId: string; session: BrowserSessionSummary | null; unavailable: boolean };

export function useChatBrowser(chatId: string | null, visible: boolean) {
  const [state, setState] = useState<BrowserState | null>(null);

  useEffect(() => {
    if (!chatId || !visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let previous: BrowserSessionSummary | null = null;

    const poll = async () => {
      if (disposed || document.hidden) return;
      controller = new AbortController();
      const { signal } = controller;
      try {
        const response = await authenticatedFetch(
          `/api/browser-use/sessions?view=summary&chatSessionId=${encodeURIComponent(chatId)}`,
          { signal },
        );
        if (!response.ok) throw new Error('Browser status unavailable');
        const body = await response.json();
        if (!body.success || !Array.isArray(body.data?.sessions)) throw new Error('Invalid browser status');
        const sessions = (body.data.sessions as BrowserSessionSummary[])
          .filter((session) => session.chatSessionId === chatId)
          .sort((a, b) => Number((b.activeToolCount ?? 0) > 0) - Number((a.activeToolCount ?? 0) > 0)
            || b.updatedAt.localeCompare(a.updatedAt));
        let session = sessions[0] ?? null;
        if (session && previous?.id === session.id && previous.screenshotVersion === session.screenshotVersion) {
          session = { ...session, screenshotDataUrl: previous.screenshotDataUrl };
        } else if (session && session.screenshotVersion > 0) {
          const full = await authenticatedFetch(`/api/browser-use/sessions/${encodeURIComponent(session.id)}`, { signal });
          if (!full.ok) throw new Error('Browser preview unavailable');
          const detail = await full.json();
          if (!detail.success || detail.data?.session?.chatSessionId !== chatId) throw new Error('Browser session changed');
          session = detail.data.session;
        }
        if (disposed || signal.aborted) return;
        previous = session;
        setState({ chatId, session, unavailable: false });
      } catch {
        if (disposed || signal.aborted) return;
        setState((current) => current?.chatId === chatId ? { ...current, unavailable: true } : null);
      } finally {
        if (!disposed && !signal.aborted && !document.hidden) timer = setTimeout(() => void poll(), 2000);
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [chatId, visible]);

  return state?.chatId === chatId ? state : null;
}
