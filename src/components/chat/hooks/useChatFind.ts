import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { searchChatFindEntries, type ChatFindEntry, type ChatFindMatch } from '../utils/chatFindIndex';
import { getChatViewportRect } from '../utils/chatScrollHost';

import { useChatTextIndex } from './useChatTextIndex';

export { isChatFindConversationMessage } from '../utils/chatFindIndex';

const SEARCH_IDLE_MS = 200;

const MATCH_HIGHLIGHT = 'chat-find-match';
const CURRENT_HIGHLIGHT = 'chat-find-current';
const FALLBACK_CURRENT_CLASS = 'chat-find-current-fallback';

export type ChatFindOccurrence = {
  range: Range;
  messageElement: HTMLElement;
  offset: number;
};

export type ChatJumpTarget = { messageId: string; recordId: string };

type UseChatFindArgs = {
  isVisible: boolean;
  sessionId: string | null;
  sessionStore: SessionStore;
  /** The store's loaded window; the index lays it over the whole-history text. */
  loadedRecords: NormalizedMessage[];
  /** Rows currently rendered; highlights refresh when they change. */
  renderedMessages: ChatMessage[];
  /** Brings a message that is not rendered into the chat; resolves false when it cannot be found. */
  jumpToMessage: (target: ChatJumpTarget) => Promise<boolean>;
  scrollContainerRef: RefObject<HTMLElement>;
  messagesContentRef: RefObject<HTMLDivElement>;
};

export type ChatFindController = {
  isOpen: boolean;
  query: string;
  currentIndex: number;
  total: number;
  isPreparing: boolean;
  loadFailed: boolean;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  next: () => void;
  previous: () => void;
  retryLoad: () => void;
};

const getChatFindContentElement = (node: Text, messageElement: HTMLElement): HTMLElement | null => {
  const parent = node.parentElement;
  if (!parent || parent.closest('.chat-message') !== messageElement) {
    return null;
  }

  const contentElement = parent.closest<HTMLElement>('[data-chat-find-content]');
  if (!contentElement || contentElement.closest('.chat-message') !== messageElement) {
    return null;
  }

  const containingControl = parent.closest('button, input, textarea, select');
  const isExcluded = Boolean(
    parent.closest('script, style, [hidden], [aria-hidden="true"], .sr-only')
    || (containingControl && !containingControl.contains(contentElement)),
  );
  return isExcluded ? null : contentElement;
};

/** Finds literal, case-insensitive ranges without changing React's rendered DOM. */
export function collectChatFindOccurrences(root: HTMLElement, query: string): ChatFindOccurrence[] {
  if (!query) {
    return [];
  }

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(escapedQuery, 'giu');
  const occurrences: ChatFindOccurrence[] = [];
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;

  for (const messageElement of root.querySelectorAll<HTMLElement>('.chat-message[data-chat-find-scope="conversation"]')) {
    const walker = root.ownerDocument.createTreeWalker(messageElement, showText);
    const segments: Array<{ node: Text; start: number; end: number }> = [];
    let searchableText = '';
    let previousContentElement: HTMLElement | null = null;
    let currentNode = walker.nextNode();

    while (currentNode) {
      const textNode = currentNode as Text;
      const contentElement = getChatFindContentElement(textNode, messageElement);
      if (!contentElement) {
        // Prevent a match from joining visible text across an omitted control or nested message.
        searchableText += '\0';
        previousContentElement = null;
      } else if (textNode.data) {
        if (previousContentElement && previousContentElement !== contentElement) {
          searchableText += '\0';
        }
        const start = searchableText.length;
        searchableText += textNode.data;
        segments.push({ node: textNode, start, end: searchableText.length });
        previousContentElement = contentElement;
      }
      currentNode = walker.nextNode();
    }

    matcher.lastIndex = 0;
    let match = matcher.exec(searchableText);
    while (match) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      const startSegment = segments.find((segment) => matchStart >= segment.start && matchStart < segment.end);
      const endSegment = segments.find((segment) => matchEnd > segment.start && matchEnd <= segment.end);

      if (startSegment && endSegment) {
        const range = root.ownerDocument.createRange();
        range.setStart(startSegment.node, matchStart - startSegment.start);
        range.setEnd(endSegment.node, matchEnd - endSegment.start);
        occurrences.push({ range, messageElement, offset: matchStart });
      }

      match = matcher.exec(searchableText);
    }
  }

  return occurrences;
}

export function stepChatFindIndex(currentIndex: number, total: number, direction: 1 | -1): number {
  if (total === 0) {
    return -1;
  }
  return (currentIndex + direction + total) % total;
}

const clearHighlights = (root: HTMLElement | null) => {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete(MATCH_HIGHLIGHT);
    CSS.highlights.delete(CURRENT_HIGHLIGHT);
  }
  root?.querySelectorAll(`.${FALLBACK_CURRENT_CLASS}`).forEach((element) => {
    element.classList.remove(FALLBACK_CURRENT_CLASS);
  });
};

const getOccurrenceRect = (occurrence: ChatFindOccurrence) => {
  if (typeof occurrence.range.getBoundingClientRect === 'function') {
    const rangeRect = occurrence.range.getBoundingClientRect();
    if (rangeRect.width > 0 || rangeRect.height > 0) {
      return rangeRect;
    }
  }
  return occurrence.messageElement.getBoundingClientRect();
};

const findRenderedRow = (root: HTMLElement, messageId: string): HTMLElement | null => {
  for (const row of root.querySelectorAll<HTMLElement>('.chat-message[data-chat-message-id]')) {
    if (row.dataset.chatMessageId === messageId) return row;
  }
  return null;
};

/**
 * Index position just below where the reader is: the first indexed message
 * rendered below the viewport's bottom edge, else just past the last indexed
 * message at or above it.
 */
export function readingBoundary(
  entries: ChatFindEntry[],
  root: HTMLElement | null,
  scrollContainer: HTMLElement | null,
): number {
  const rows = root ? Array.from(root.querySelectorAll<HTMLElement>('.chat-message[data-chat-message-id]')) : [];
  if (rows.length === 0 || !scrollContainer) return entries.length;
  const viewportBottom = getChatViewportRect(scrollContainer).bottom;
  let reading = rows.length - 1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].getBoundingClientRect().top >= viewportBottom) {
      reading = Math.max(0, index - 1);
      break;
    }
  }
  const position = new Map(entries.map((entry, index) => [entry.messageId, index]));
  for (let index = reading + 1; index < rows.length; index += 1) {
    const entry = position.get(rows[index].dataset.chatMessageId!);
    if (entry !== undefined) return entry;
  }
  for (let index = reading; index >= 0; index -= 1) {
    const entry = position.get(rows[index].dataset.chatMessageId!);
    if (entry !== undefined) return entry + 1;
  }
  return entries.length;
}

/** The newest match at or above the reader; with none above, the nearest below. */
export function initialMatchIndex(matches: ChatFindMatch[], boundary: number): number {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index].entry < boundary) return index;
  }
  return matches.length > 0 ? 0 : -1;
}

const scrollToOccurrence = (
  target: ChatFindOccurrence | HTMLElement,
  scrollContainer: HTMLElement | null,
) => {
  if (!scrollContainer) {
    return;
  }

  const element = target instanceof HTMLElement ? target : target.messageElement;
  const matchRect = target instanceof HTMLElement ? target.getBoundingClientRect() : getOccurrenceRect(target);
  const containerRect = getChatViewportRect(scrollContainer);
  if (matchRect.top >= containerRect.top && matchRect.bottom <= containerRect.bottom) {
    return;
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (typeof scrollContainer.scrollTo === 'function' && (matchRect.width > 0 || matchRect.height > 0)) {
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + matchRect.top - containerRect.top - ((containerRect.bottom - containerRect.top) / 2),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    return;
  }

  element.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
};

/**
 * Owns the open chat's find state; the header is only a view of this controller.
 * Matches come from a text index of the whole conversation, so old matches need
 * no rendered history: stepping to one outside the rendered rows jumps there.
 */
export function useChatFind({
  isVisible,
  sessionId,
  sessionStore,
  loadedRecords,
  renderedMessages,
  jumpToMessage,
  scrollContainerRef,
  messagesContentRef,
}: UseChatFindArgs): ChatFindController {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [matches, setMatches] = useState<ChatFindMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastQueryRef = useRef('');
  const activeMatchRef = useRef<ChatFindMatch | null>(null);
  const jumpedKeyRef = useRef<string | null>(null);
  const scrolledKeyRef = useRef<string | null>(null);
  const index = useChatTextIndex({ sessionStore, sessionId, enabled: isOpen, loadedRecords });
  const { entries } = index;

  const open = useCallback(() => {
    if (isOpen) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setQueryState('');
    setMatches([]);
    setCurrentIndex(-1);
    activeMatchRef.current = null;
    lastQueryRef.current = '';
    setIsOpen(true);
  }, [isOpen]);

  const closeWithoutFocus = useCallback(() => {
    clearHighlights(messagesContentRef.current);
    setIsOpen(false);
    setQueryState('');
    setMatches([]);
    setCurrentIndex(-1);
    activeMatchRef.current = null;
    lastQueryRef.current = '';
    jumpedKeyRef.current = null;
    scrolledKeyRef.current = null;
  }, [messagesContentRef]);

  const close = useCallback(() => {
    const previousFocus = previousFocusRef.current;
    closeWithoutFocus();
    window.requestAnimationFrame(() => {
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else {
        document.querySelector<HTMLElement>('[data-main-content-header-menu-trigger]')?.focus();
      }
    });
  }, [closeWithoutFocus]);

  useEffect(() => {
    closeWithoutFocus();
  }, [sessionId, isVisible, closeWithoutFocus]);

  useEffect(() => {
    if (!isVisible || !sessionId) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const isFindShortcut = (event.metaKey || event.ctrlKey)
        && !event.altKey
        && event.key.toLowerCase() === 'f';
      if (isFindShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        open();
        if (isOpen) {
          const input = document.querySelector<HTMLInputElement>('[data-chat-find-input]');
          input?.focus();
          input?.select();
        }
        return;
      }
      if (isOpen && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [close, isOpen, isVisible, open, sessionId]);

  // Search the index; a rebuild under the same query keeps the current match.
  useEffect(() => {
    if (!isOpen || !query || !entries) {
      setMatches([]);
      setCurrentIndex(-1);
      activeMatchRef.current = null;
      lastQueryRef.current = query;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const nextMatches = searchChatFindEntries(entries, query);
      const active = lastQueryRef.current === query ? activeMatchRef.current : null;
      const retained = active
        ? nextMatches.findIndex((match) => match.messageId === active.messageId && match.ordinal === active.ordinal)
        : -1;
      const nextIndex = retained >= 0
        ? retained
        : initialMatchIndex(nextMatches, readingBoundary(entries, messagesContentRef.current, scrollContainerRef.current));
      setMatches(nextMatches);
      setCurrentIndex(nextIndex);
      activeMatchRef.current = nextIndex >= 0 ? nextMatches[nextIndex] : null;
      lastQueryRef.current = query;
    }, SEARCH_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [entries, isOpen, messagesContentRef, query, scrollContainerRef]);

  // Highlight what is rendered; bring the current match into the chat when it is not.
  useEffect(() => {
    const root = messagesContentRef.current;
    clearHighlights(root);
    if (!isOpen || !query || !root) {
      return undefined;
    }
    const current = currentIndex >= 0 ? matches[currentIndex] : undefined;
    activeMatchRef.current = current ?? null;

    const occurrences = collectChatFindOccurrences(root, query);
    const row = current ? findRenderedRow(root, current.messageId) : null;
    const key = current ? `${current.messageId}:${current.ordinal}` : null;
    if (current && key && !row && jumpedKeyRef.current !== key) {
      jumpedKeyRef.current = key;
      scrolledKeyRef.current = null;
      void jumpToMessage({ messageId: current.messageId, recordId: current.recordId });
    }

    const inRow = row ? occurrences.filter((occurrence) => occurrence.messageElement === row) : [];
    const currentOccurrence = current && inRow.length > 0 ? inRow[Math.min(current.ordinal, inRow.length - 1)] : null;
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      if (occurrences.length > 0) CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...occurrences.map((occurrence) => occurrence.range)));
      if (currentOccurrence) {
        const currentHighlight = new Highlight(currentOccurrence.range);
        currentHighlight.priority = 1;
        CSS.highlights.set(CURRENT_HIGHLIGHT, currentHighlight);
      } else {
        row?.classList.add(FALLBACK_CURRENT_CLASS);
      }
    } else {
      row?.classList.add(FALLBACK_CURRENT_CLASS);
    }

    if (row && key && scrolledKeyRef.current !== key) {
      scrolledKeyRef.current = key;
      scrollToOccurrence(currentOccurrence ?? row, scrollContainerRef.current);
    }
    return () => clearHighlights(root);
  }, [currentIndex, isOpen, jumpToMessage, matches, messagesContentRef, query, renderedMessages, scrollContainerRef]);

  useEffect(() => () => clearHighlights(messagesContentRef.current), [messagesContentRef]);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(nextQuery);
    setMatches([]);
    setCurrentIndex(-1);
    jumpedKeyRef.current = null;
    clearHighlights(messagesContentRef.current);
  }, [messagesContentRef]);

  const next = useCallback(() => {
    setCurrentIndex((value) => stepChatFindIndex(value, matches.length, 1));
  }, [matches.length]);

  const previous = useCallback(() => {
    setCurrentIndex((value) => stepChatFindIndex(value, matches.length, -1));
  }, [matches.length]);

  return useMemo(() => ({
    isOpen,
    query,
    currentIndex,
    total: matches.length,
    isPreparing: index.isPreparing,
    loadFailed: index.loadFailed,
    open,
    close,
    setQuery,
    next,
    previous,
    retryLoad: index.retry,
  }), [
    close,
    currentIndex,
    index.isPreparing,
    index.loadFailed,
    index.retry,
    isOpen,
    matches.length,
    next,
    open,
    previous,
    query,
    setQuery,
  ]);
}
