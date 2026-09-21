import { useCallback, useEffect, useRef, useState } from 'react';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { authenticatedFetch } from '../../../utils/api';
import type { ChatMessage } from '../types/types';
import { normalizedToChatMessages } from './useChatMessages';

export type HistoryDetailStatus = 'idle' | 'loading' | 'loaded' | 'error';

// Full tool payloads can be megabytes, so only recently opened ones stay.
const MAX_CACHED_DETAILS = 16;
const details = new Map<string, Promise<ChatMessage>>();

function detailKey(message: ChatMessage): string {
  return `${message.historySessionId}\u0000${message.id}`;
}

export function loadHistoryDetail(message: ChatMessage): Promise<ChatMessage> {
  const key = detailKey(message);
  const cached = details.get(key);
  if (cached) {
    details.delete(key);
    details.set(key, cached);
    return cached;
  }
  const url = `/api/providers/sessions/${encodeURIComponent(message.historySessionId!)}/messages/${encodeURIComponent(message.id!)}`;
  const request = authenticatedFetch(url)
    .then(async (response: Response) => {
      if (!response.ok) throw new Error(`Detail request failed (${response.status})`);
      const payload = await response.json() as { data: NormalizedMessage };
      const full = normalizedToChatMessages([payload.data]).find((candidate) => candidate.isToolUse && candidate.id === message.id);
      if (!full) throw new Error('Detail record is not a tool call');
      return full;
    });
  request.catch(() => {
    if (details.get(key) === request) details.delete(key);
  });
  details.set(key, request);
  while (details.size > MAX_CACHED_DETAILS) details.delete(details.keys().next().value!);
  return request;
}

/**
 * A tool message whose page copy omitted heavy payloads resolves to its
 * complete record once requested; everything else passes through unchanged.
 */
export function useHistoryDetail(message: ChatMessage, loadImmediately: boolean): {
  message: ChatMessage;
  status: HistoryDetailStatus;
  request: () => void;
} {
  const elided = Boolean(message.elidedDetail && message.historySessionId && message.id);
  const [state, setState] = useState<{ source: ChatMessage; full: ChatMessage | null; status: HistoryDetailStatus }>(
    { source: message, full: null, status: 'idle' },
  );
  const current = state.source === message ? state : { source: message, full: null, status: 'idle' as const };
  const statusRef = useRef(current.status);
  statusRef.current = current.status;

  const request = useCallback(() => {
    if (!elided || statusRef.current === 'loading' || statusRef.current === 'loaded') return;
    statusRef.current = 'loading';
    setState({ source: message, full: null, status: 'loading' });
    loadHistoryDetail(message).then(
      (full) => setState((previous) => (previous.source === message ? { source: message, full, status: 'loaded' } : previous)),
      () => setState((previous) => (previous.source === message ? { source: message, full: null, status: 'error' } : previous)),
    );
  }, [elided, message]);

  useEffect(() => {
    if (loadImmediately && elided) request();
  }, [loadImmediately, elided, request]);

  if (!elided) return { message, status: 'idle', request };
  return { message: current.full ? { ...message, ...current.full, elidedDetail: undefined } : message, status: current.status, request };
}

/** Replaces every elided tool message with its complete record, in one request; rejects rather than export partial output. */
export async function hydrateHistoryDetails(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const sessionId = messages.find((message) => message.elidedDetail && message.historySessionId)?.historySessionId;
  if (!sessionId) return messages;
  const response = await authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?payload=full`);
  if (!response.ok) throw new Error(`Full history request failed (${response.status})`);
  const payload = await response.json() as { data: { messages: NormalizedMessage[] } };
  const complete = new Map<string, ChatMessage>();
  for (const message of normalizedToChatMessages(payload.data.messages)) {
    if (message.isToolUse && message.id) complete.set(message.id, message);
  }
  return messages.map((message) => {
    if (!message.elidedDetail) return message;
    const full = message.id ? complete.get(message.id) : undefined;
    if (!full) throw new Error('History changed while exporting');
    return { ...message, ...full, elidedDetail: undefined };
  });
}
