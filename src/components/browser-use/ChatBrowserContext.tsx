import { createContext, useContext } from 'react';

import type { BrowserSessionSummary } from '../../../shared/browser-use';

export type ChatBrowserState = {
  /** This chat's browser session, polled; null when it has none. */
  session: BrowserSessionSummary | null;
  unavailable: boolean;
  /** Absent when the Browser tab is off. */
  onOpen?: (browserSessionId: string) => void;
};

export const ChatBrowserContext = createContext<ChatBrowserState>({ session: null, unavailable: false });

export const useChatBrowserState = (): ChatBrowserState => useContext(ChatBrowserContext);

/** The session is still running a page, so the Browser tab has something to show. */
export const isBrowserOpen = (state: Pick<ChatBrowserState, 'session' | 'unavailable'> | null): boolean =>
  Boolean(state?.session && !state.unavailable && state.session.status === 'ready');
