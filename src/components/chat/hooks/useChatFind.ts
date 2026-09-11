import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { ChatMessage } from '../types/types';

const MATCH_HIGHLIGHT = 'chat-find-match';
const CURRENT_HIGHLIGHT = 'chat-find-current';
const FALLBACK_CURRENT_CLASS = 'chat-find-current-fallback';

export type ChatFindOccurrence = {
  range: Range;
  messageElement: HTMLElement;
  offset: number;
};

type ChatFindIdentity = Pick<ChatFindOccurrence, 'messageElement' | 'offset'>;

export function isChatFindConversationMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    return true;
  }

  return message.type === 'assistant'
    && !message.isToolUse
    && !message.isThinking
    && !message.isCompactSummary
    && !message.isCompactBoundary
    && !message.isSystemNotice
    && !message.isTaskNotification
    && !message.isLocalCommandStdout;
}

type UseChatFindArgs = {
  isVisible: boolean;
  sessionId: string | null;
  chatMessages: ChatMessage[];
  hasMoreMessages: boolean;
  loadAllMessages: () => Promise<ChatMessage[] | null>;
  scrollContainerRef: RefObject<HTMLDivElement>;
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

const initialIndexFromViewport = (
  occurrences: ChatFindOccurrence[],
  scrollContainer: HTMLElement | null,
) => {
  if (occurrences.length === 0 || !scrollContainer) {
    return occurrences.length > 0 ? 0 : -1;
  }
  const viewportTop = scrollContainer.getBoundingClientRect().top;
  const index = occurrences.findIndex((occurrence) => getOccurrenceRect(occurrence).bottom >= viewportTop);
  return index >= 0 ? index : 0;
};

const scrollToOccurrence = (
  occurrence: ChatFindOccurrence,
  scrollContainer: HTMLElement | null,
) => {
  if (!scrollContainer) {
    return;
  }

  const matchRect = getOccurrenceRect(occurrence);
  const containerRect = scrollContainer.getBoundingClientRect();
  if (matchRect.top >= containerRect.top && matchRect.bottom <= containerRect.bottom) {
    return;
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (typeof scrollContainer.scrollTo === 'function' && (matchRect.width > 0 || matchRect.height > 0)) {
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + matchRect.top - containerRect.top - (scrollContainer.clientHeight / 2),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    return;
  }

  occurrence.messageElement.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
};

/** Owns the open chat's find state; the header is only a view of this controller. */
export function useChatFind({
  isVisible,
  sessionId,
  chatMessages,
  hasMoreMessages,
  loadAllMessages,
  scrollContainerRef,
  messagesContentRef,
}: UseChatFindArgs): ChatFindController {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [occurrences, setOccurrences] = useState<ChatFindOccurrence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPreparing, setIsPreparing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const loadAttemptRef = useRef(0);
  const lastQueryRef = useRef('');
  const activeIdentityRef = useRef<ChatFindIdentity | null>(null);

  const prepareCompleteHistory = useCallback(async () => {
    const attempt = ++loadAttemptRef.current;
    setLoadFailed(false);
    if (!hasMoreMessages) {
      setIsPreparing(false);
      return;
    }

    setIsPreparing(true);
    const loaded = await loadAllMessages();
    if (attempt !== loadAttemptRef.current) {
      return;
    }
    setIsPreparing(false);
    setLoadFailed(loaded === null);
  }, [hasMoreMessages, loadAllMessages]);

  const open = useCallback(() => {
    if (isOpen) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setQueryState('');
    setOccurrences([]);
    setCurrentIndex(-1);
    activeIdentityRef.current = null;
    lastQueryRef.current = '';
    setIsOpen(true);
    void prepareCompleteHistory();
  }, [isOpen, prepareCompleteHistory]);

  const closeWithoutFocus = useCallback(() => {
    loadAttemptRef.current += 1;
    clearHighlights(messagesContentRef.current);
    setIsOpen(false);
    setQueryState('');
    setOccurrences([]);
    setCurrentIndex(-1);
    setIsPreparing(false);
    setLoadFailed(false);
    activeIdentityRef.current = null;
    lastQueryRef.current = '';
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

  const retryLoad = useCallback(() => {
    void prepareCompleteHistory();
  }, [prepareCompleteHistory]);

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

  useEffect(() => {
    const root = messagesContentRef.current;
    clearHighlights(root);
    if (!isOpen || isPreparing || loadFailed || !query || !root) {
      setOccurrences([]);
      setCurrentIndex(-1);
      activeIdentityRef.current = null;
      lastQueryRef.current = query;
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const nextOccurrences = collectChatFindOccurrences(root, query);
      const queryChanged = lastQueryRef.current !== query;
      const retainedIndex = !queryChanged && activeIdentityRef.current
        ? nextOccurrences.findIndex((occurrence) => (
            occurrence.messageElement === activeIdentityRef.current?.messageElement
            && occurrence.offset === activeIdentityRef.current.offset
          ))
        : -1;
      const nextIndex = retainedIndex >= 0
        ? retainedIndex
        : initialIndexFromViewport(nextOccurrences, scrollContainerRef.current);
      setOccurrences(nextOccurrences);
      setCurrentIndex(nextIndex);
      activeIdentityRef.current = nextIndex >= 0 ? nextOccurrences[nextIndex] : null;
      lastQueryRef.current = query;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, isOpen, isPreparing, loadFailed, messagesContentRef, query, scrollContainerRef]);

  useEffect(() => {
    const root = messagesContentRef.current;
    clearHighlights(root);
    if (!isOpen || occurrences.length === 0 || currentIndex < 0) {
      return undefined;
    }

    const current = occurrences[currentIndex];
    if (!current) {
      return undefined;
    }
    activeIdentityRef.current = current;

    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      const allHighlight = new Highlight(...occurrences.map((occurrence) => occurrence.range));
      const currentHighlight = new Highlight(current.range);
      currentHighlight.priority = 1;
      CSS.highlights.set(MATCH_HIGHLIGHT, allHighlight);
      CSS.highlights.set(CURRENT_HIGHLIGHT, currentHighlight);
    } else {
      current.messageElement.classList.add(FALLBACK_CURRENT_CLASS);
    }

    scrollToOccurrence(current, scrollContainerRef.current);
    return () => clearHighlights(root);
  }, [currentIndex, isOpen, messagesContentRef, occurrences, scrollContainerRef]);

  useEffect(() => () => clearHighlights(messagesContentRef.current), [messagesContentRef]);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(nextQuery);
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((index) => stepChatFindIndex(index, occurrences.length, 1));
  }, [occurrences.length]);

  const previous = useCallback(() => {
    setCurrentIndex((index) => stepChatFindIndex(index, occurrences.length, -1));
  }, [occurrences.length]);

  return useMemo(() => ({
    isOpen,
    query,
    currentIndex,
    total: occurrences.length,
    isPreparing,
    loadFailed,
    open,
    close,
    setQuery,
    next,
    previous,
    retryLoad,
  }), [
    close,
    currentIndex,
    isOpen,
    isPreparing,
    loadFailed,
    next,
    occurrences.length,
    open,
    previous,
    query,
    retryLoad,
    setQuery,
  ]);
}
