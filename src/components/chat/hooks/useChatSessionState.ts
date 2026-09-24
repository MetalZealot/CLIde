import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionIdle, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { ReplayProgress } from '../../../contexts/WebSocketContext';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';
import { getChatViewportRect, isPageScrollHost, scrollEventTarget } from '../utils/chatScrollHost';
import { chatFindEntriesForRecord, locateSearchTarget } from '../utils/chatFindIndex';

import type { ChatJumpTarget } from './useChatFind';
import { normalizedToChatMessages } from './useChatMessages';

export const MESSAGES_PER_PAGE = 20;
/** A chain of loads that each added too little height doubles its page up to this. */
const MAX_CHAINED_PAGE = 160;
const INITIAL_VISIBLE_MESSAGES = 100;
const TOP_LOAD_THRESHOLD_PX = 100;
const TOP_LOAD_REARM_MARGIN_PX = 40;
/** Screens of history kept above the reader, so arriving at the top rarely waits for a page. */
const TOP_PREFETCH_SCREENS = 1.5;
/** Rows kept each side of a jump target: a screen or two of context. */
const JUMP_ROWS_AROUND = 15;
/** Records fetched around a jump target that is not loaded. */
const JUMP_RECORDS = 40;

const topLoadDistance = (container: HTMLElement): number =>
  Math.max(TOP_LOAD_THRESHOLD_PX, container.clientHeight * TOP_PREFETCH_SCREENS);
const topLoadRearmDistance = (container: HTMLElement): number =>
  topLoadDistance(container) + TOP_LOAD_REARM_MARGIN_PX;
const distanceToBottom = (container: HTMLElement): number =>
  container.scrollHeight - container.scrollTop - container.clientHeight;

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  processingSessions?: SessionActivityMap;
  onSessionIdle?: MarkSessionIdle;
  resetStreamingState: () => void;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  /** Transport-tracked replay progress; sent as `lastSeq` + `runId` on subscribe. */
  getReplayProgress: (sessionId: string) => ReplayProgress | null;
  sessionStore: SessionStore;
  /** The page scrolls instead of the message pane (phones). */
  pageScroll?: boolean;
}

export interface ScrollRestoreState {
  height: number;
  top: number;
  anchor: HTMLElement | null;
  anchorOffset: number | null;
}

function captureScrollRestore(container: HTMLElement): ScrollRestoreState {
  const containerRect = getChatViewportRect(container);
  const anchor = Array.from(container.querySelectorAll<HTMLElement>('.chat-message')).find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  }) ?? null;

  return {
    height: container.scrollHeight,
    top: container.scrollTop,
    anchor,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - containerRect.top : null,
  };
}

export function applyScrollRestore(container: HTMLElement, restore: ScrollRestoreState): void {
  // Every geometry read precedes the write: a read after it lays the whole pane out again.
  const height = container.scrollHeight;
  // Anchoring is off, so any scroll since the target was recorded is the reader's: keep it.
  const readerScroll = container.scrollTop - restore.top;
  if (restore.anchor?.isConnected && restore.anchorOffset !== null) {
    const currentOffset = restore.anchor.getBoundingClientRect().top - getChatViewportRect(container).top;
    restore.anchorOffset -= readerScroll;
    container.scrollTop += currentOffset - restore.anchorOffset;
  } else {
    container.scrollTop = restore.top + readerScroll + Math.max(height - restore.height, 0);
  }

  restore.height = height;
  restore.top = container.scrollTop;
}

function updateScrollRestoreTarget(container: HTMLElement, restore: ScrollRestoreState): void {
  if (restore.anchor?.isConnected) {
    restore.anchorOffset = restore.anchor.getBoundingClientRect().top - getChatViewportRect(container).top;
  }
  restore.height = container.scrollHeight;
  restore.top = container.scrollTop;
}

/* ------------------------------------------------------------------ */
/*  Helper: Convert a ChatMessage to a NormalizedMessage for the store */
/* ------------------------------------------------------------------ */

function chatMessageToNormalized(
  msg: ChatMessage,
  sessionId: string,
  provider: LLMProvider,
): NormalizedMessage | null {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp instanceof Date
    ? msg.timestamp.toISOString()
    : typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : String(msg.timestamp);
  const base = { id, sessionId, timestamp: ts, provider };

  if (msg.isToolUse) {
    return {
      ...base,
      kind: 'tool_use',
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolId: msg.toolId || id,
    } as NormalizedMessage;
  }
  if (msg.isThinking) {
    return { ...base, kind: 'thinking', content: msg.content || '' } as NormalizedMessage;
  }
  if (msg.isInteractivePrompt) {
    return { ...base, kind: 'interactive_prompt', content: msg.content || '' } as NormalizedMessage;
  }
  if ((msg as any).isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: (msg as any).taskStatus || 'completed',
      summary: msg.content || '',
    } as NormalizedMessage;
  }
  if (msg.type === 'error') {
    return { ...base, kind: 'error', content: msg.content || '' } as NormalizedMessage;
  }
  return {
    ...base,
    kind: 'text',
    role: msg.type === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
    isSystemNotice: msg.isSystemNotice || undefined,
    // Keep attachment references on the local echo so the user bubble shows
    // its files immediately, before the server-backed copy replaces it.
    images: Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : undefined,
    files: Array.isArray(msg.files) && msg.files.length > 0 ? msg.files : undefined,
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  externalMessageUpdate,
  newSessionTrigger,
  processingSessions,
  onSessionIdle,
  resetStreamingState,
  statusCheckSentAtRef,
  getReplayProgress,
  sessionStore,
  pageScroll = false,
}: UseChatSessionStateArgs) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [scrollRestoreTick, setScrollRestoreTick] = useState(0);
  const [viewHiddenCount, setViewHiddenCount] = useState(0);
  const [selectionStartIndex, setSelectionStartIndex] = useState<number | null>(null);
  /**
   * Rows rendered away from the live tail after a jump. Ids bound it; a null
   * edge follows the loaded window. Null: the tail window of `visibleMessageCount`.
   */
  const [viewRange, setViewRange] = useState<{ startId: string | null; endId: string | null } | null>(null);
  const [flashTargetId, setFlashTargetId] = useState<string | null>(null);

  const selectedSessionId = selectedSession?.id ?? null;
  /** The pane, or the document root when the page scrolls; set by the pane's ref. */
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  /** A non-empty selection inside the messages; scrolling must not move text under it. */
  const hasChatSelectionRef = useRef(false);
  /** First rendered message index held while selecting, so arrivals cannot trim it. */
  const selectionStartIndexRef = useRef<number | null>(null);
  /** Last page position while the chat was showing; the page collapses under other tabs. */
  const lastPageScrollTopRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const isUserScrolledUpRef = useRef(false);
  isUserScrolledUpRef.current = isUserScrolledUp;
  // Render-time mirrors of the rendered window, for scroll handlers and jumps.
  const viewRangeRef = useRef<typeof viewRange>(null);
  const windowStartRef = useRef(0);
  const windowEndRef = useRef(0);
  const isViewDetachedRef = useRef(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const isLoadingNewerRef = useRef(false);
  const returnToLatestRef = useRef<() => void>(() => undefined);
  const jumpToMessageRef = useRef<(target: ChatJumpTarget) => Promise<boolean>>(async () => false);
  const [searchTarget, setSearchTarget] = useState<{ timestamp?: string; uuid?: string; snippet?: string } | null>(null);
  const searchScrollActiveRef = useRef(false);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const topLoadArmedRef = useRef(true);
  const chainedPageSizeRef = useRef(MESSAGES_PER_PAGE);
  const capturedScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const settlingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const scrollRestoreReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const externalUpdateTargetRef = useRef<{ version: number; sessionId: string | null }>({
    version: 0,
    sessionId: null,
  });
  const handledExternalUpdateRef = useRef(0);
  /**
   * Tracks the last processed value from `useProjectsState.newSessionTrigger`.
   *
   * The trigger itself is intentionally increment-only and routed via:
   * useProjectsState -> AppContent -> MainContent -> ChatInterface -> this hook.
   * We compare values to ensure each explicit New Session click runs exactly one
   * reset pass in this local chat state domain.
   */
  const previousNewSessionTriggerRef = useRef(newSessionTrigger ?? 0);

  const cancelSettlingScrollRestore = useCallback(() => {
    settlingScrollRestoreRef.current = null;
    if (scrollRestoreReleaseTimerRef.current) {
      clearTimeout(scrollRestoreReleaseTimerRef.current);
      scrollRestoreReleaseTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelSettlingScrollRestore, [cancelSettlingScrollRestore]);

  // Declared before the scroll layout effects so the page is already scrollable when they run.
  useLayoutEffect(() => {
    if (!pageScroll) return;
    document.documentElement.classList.add('chat-page-scroll');
    return () => document.documentElement.classList.remove('chat-page-scroll');
  }, [pageScroll]);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  useEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === previousNewSessionTriggerRef.current) {
      return;
    }
    previousNewSessionTriggerRef.current = trigger;

    /**
     * Consumer-side reset for explicit New Session intent.
     *
     * Why this is essential:
     * - Chat keeps local state that is not fully derived from `selectedSession`:
     *   `currentSessionId`, `pendingUserMessage`, streaming/status flags, message
     *   pagination/scroll bookkeeping, and provider-specific sessionStorage keys.
     * - If the user clicks New Session while already on the same route with no
     *   selected session, parent state updates can be idempotent and this local
     *   state would otherwise persist, making the click appear to "do nothing".
     *
     * What this reset guarantees:
     * - A deterministic clean draft state on every New Session click.
     * - No dependence on route/tab/session-object identity changes.
     * - No coupling to unrelated external update signals.
     */
    resetStreamingState();
    currentSessionIdRef.current = null;
    setCurrentSessionId(null);
    setPendingUserMessage(null);
    
    setTokenBudget(null);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setViewRange(null);
    setAllMessagesLoaded(false);
    setIsLoadingAllMessages(false);
    setViewHiddenCount(0);
    setSearchTarget(null);
    searchScrollActiveRef.current = false;
    topLoadArmedRef.current = true;
    chainedPageSizeRef.current = MESSAGES_PER_PAGE;
    capturedScrollRestoreRef.current = null;
    pendingScrollRestoreRef.current = null;
    cancelSettlingScrollRestore();
    pendingInitialScrollRef.current = true;
    isUserScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
  }, [cancelSettlingScrollRestore, newSessionTrigger, onSessionIdle, resetStreamingState]);

  /* ---------------------------------------------------------------- */
  /*  Derive processing state for the viewed session                  */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;

  // The activity indicator always reflects the latest status of the session
  // being viewed — never stale local UI state from the last time it was
  // open. Session ids are concrete before any send, so no pending
  // placeholder entry exists anymore.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null;
  const canAbortSession = isProcessing && sessionActivity.canInterrupt;

  // Ref mirror so effects can read the latest map without re-running on
  // every activity transition.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const flushedPendingUserMessageRef = useRef<ChatMessage | null>(null);

  // Tell the store which session we're viewing so it only re-renders for this one
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionId !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionId;
    sessionStore.setActiveSession(activeSessionId);
  }

  useEffect(() => {
    if (!pendingUserMessage) {
      flushedPendingUserMessageRef.current = null;
      return;
    }

    if (!activeSessionId) {
      return;
    }

    if (flushedPendingUserMessageRef.current === pendingUserMessage) {
      return;
    }

    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }

    flushedPendingUserMessageRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSessionId, pendingUserMessage, sessionStore]);

  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : [];
  const activeSessionSlot = activeSessionId ? sessionStore.getSessionSlot(activeSessionId) : undefined;
  const hasMoreMessages = Boolean(activeSessionSlot?.hasMore);
  const turnStartedAt = activeSessionSlot?.turnStartedAt ?? null;

  // Reset viewHiddenCount when store messages change
  const prevStoreLenRef = useRef(0);
  if (storeMessages.length !== prevStoreLenRef.current) {
    prevStoreLenRef.current = storeMessages.length;
    if (viewHiddenCount > 0) setViewHiddenCount(0);
  }

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    if (viewHiddenCount > 0 && viewHiddenCount < all.length) return all.slice(0, -viewHiddenCount);
    return all;
  }, [storeMessages, viewHiddenCount, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage / clearMessages / rewindMessages                     */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet — show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    // A message sent from a jumped-to window lands in the live conversation, so show it.
    if (msg.type === 'user' && isViewDetachedRef.current) returnToLatestRef.current();
    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore]);

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return;
    sessionStore.clearRealtime(activeSessionId);
  }, [activeSessionId, sessionStore]);

  const rewindMessages = useCallback((count: number) => setViewHiddenCount(count), []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    const slot = activeSessionId ? sessionStore.getSessionSlot(activeSessionId) : undefined;
    if (viewRangeRef.current || slot?.hasNewer) {
      // Back from a jump: the latest page, followed from the bottom as on open.
      const rejoin = () => {
        setViewRange(null);
        setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
        setAllMessagesLoaded(false);
        pendingInitialScrollRef.current = true;
        isUserScrolledUpRef.current = false;
        setIsUserScrolledUp(false);
      };
      if (activeSessionId && slot?.hasNewer) {
        void sessionStore.fetchFromServer(activeSessionId, { limit: MESSAGES_PER_PAGE, onBeforeNotify: rejoin });
      } else {
        rejoin();
      }
      return;
    }
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
    }
  }, [activeSessionId, allMessagesLoaded, scrollToBottom, sessionStore]);
  returnToLatestRef.current = scrollToBottomAndReset;

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLElement, limit = MESSAGES_PER_PAGE) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return false;
      if (!hasMoreMessages || !selectedSession?.id || !selectedProject?.projectId) return false;

      isLoadingMoreRef.current = true;
      setIsLoadingMoreMessages(true);
      const scrollRestore = captureScrollRestore(container);
      capturedScrollRestoreRef.current = scrollRestore;
      const previousSlot = sessionStore.getSlot(selectedSession.id);
      const previousOffset = previousSlot.offset;
      const previousServerMessageCount = previousSlot.serverMessages.length;
      let restoreWasArmed = false;

      try {
        const slot = await sessionStore.fetchMore(selectedSession.id, {
          limit,
          onBeforeNotify: (updatedSlot) => {
            const madeProgress =
              updatedSlot.offset > previousOffset
              || updatedSlot.serverMessages.length > previousServerMessageCount;

            // The store notification and these local updates are automatically
            // batched by React 18. Older DOM rows, the larger visible window,
            // and the pending anchor therefore arrive in one commit, allowing
            // the layout effect to restore position before the browser paints.
            restoreWasArmed = true;
            pendingScrollRestoreRef.current = scrollRestore;
            capturedScrollRestoreRef.current = null;
            setScrollRestoreTick((tick) => tick + 1);
            if (madeProgress) {
              if (viewRangeRef.current) setViewRange((range) => range && { ...range, startId: null });
              else setVisibleMessageCount((prev) => prev + limit);
            }
            if (!updatedSlot.hasMore) {
              setAllMessagesLoaded(true);
            }
          },
        });
        if (!slot) return false;
        const madeProgress =
          slot.offset > previousOffset || slot.serverMessages.length > previousServerMessageCount;

        if (!madeProgress) {
          if (!slot.hasMore) {
            setAllMessagesLoaded(true);
          }
          return false;
        }

        // Keep a defensive fallback in case a future store implementation
        // applies a page without invoking the pre-notify hook.
        if (!restoreWasArmed) {
          pendingScrollRestoreRef.current = scrollRestore;
          capturedScrollRestoreRef.current = null;
          setScrollRestoreTick((tick) => tick + 1);
          if (viewRangeRef.current) setViewRange((range) => range && { ...range, startId: null });
          else setVisibleMessageCount((prev) => prev + limit);
          if (!slot.hasMore) {
            setAllMessagesLoaded(true);
          }
        }
        return true;
      } finally {
        if (capturedScrollRestoreRef.current === scrollRestore) {
          capturedScrollRestoreRef.current = null;
        }
        isLoadingMoreRef.current = false;
        setIsLoadingMoreMessages(false);
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, selectedProject?.projectId, selectedSession?.id, sessionStore],
  );

  /** Loaded rows above the rendered window need no request, only the prepend anchor. */
  const revealOlderRows = useCallback((container: HTMLElement, count = MESSAGES_PER_PAGE): boolean => {
    const start = windowStartRef.current;
    if (start <= 0) return false;
    pendingScrollRestoreRef.current = captureScrollRestore(container);
    setScrollRestoreTick((tick) => tick + 1);
    if (viewRangeRef.current) {
      const nextStart = Math.max(0, start - count);
      const id = chatMessagesRef.current[nextStart]?.id;
      setViewRange((range) => range && { ...range, startId: nextStart === 0 || !id ? null : id });
    } else {
      setVisibleMessageCount((visible) => visible + count);
    }
    return true;
  }, []);

  /**
   * Below a jumped-to window: loaded rows first, then newer pages. Reaching the
   * live tail resumes the ordinary tail window.
   */
  const revealNewer = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || isLoadingNewerRef.current || !isViewDetachedRef.current) return;
    const messages = chatMessagesRef.current;
    const end = windowEndRef.current;
    if (viewRangeRef.current && end < messages.length) {
      const nextEnd = Math.min(messages.length, end + MESSAGES_PER_PAGE);
      const id = messages[nextEnd - 1]?.id;
      setViewRange((range) => range && { ...range, endId: nextEnd >= messages.length || !id ? null : id });
      return;
    }
    if (sessionStore.getSessionSlot(sessionId)?.hasNewer) {
      isLoadingNewerRef.current = true;
      try {
        await sessionStore.fetchNewer(sessionId, { limit: MESSAGES_PER_PAGE });
      } finally {
        isLoadingNewerRef.current = false;
      }
      return;
    }
    setVisibleMessageCount(Math.max(INITIAL_VISIBLE_MESSAGES, messages.length - windowStartRef.current));
    setViewRange(null);
  }, [sessionStore]);

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const trackedRestore = capturedScrollRestoreRef.current ?? settlingScrollRestoreRef.current;
    if (trackedRestore) updateScrollRestoreTarget(container, trackedRestore);

    // A jumped-to window's bottom is not the conversation's: never follow it.
    const detached = isViewDetachedRef.current;
    const scrolledUp = !isNearBottom() || detached;
    isUserScrolledUpRef.current = scrolledUp;
    setIsUserScrolledUp(scrolledUp);

    if (container.scrollTop >= topLoadRearmDistance(container)) {
      topLoadArmedRef.current = true;
    }

    if (detached && distanceToBottom(container) < topLoadDistance(container)) {
      void revealNewer();
    }

    const scrolledNearTop = container.scrollTop < topLoadDistance(container);
    if (!scrolledNearTop || !topLoadArmedRef.current) return;
    if (windowStartRef.current > 0) {
      topLoadArmedRef.current = false;
      revealOlderRows(container);
      return;
    }
    if (!hasMoreMessages) return;

    // One request per approach to the top. The restore effect re-arms only after
    // the prepend creates enough real scroll distance; collapsed transcript rows
    // are fetched through automatically instead of leaving a false "roof".
    topLoadArmedRef.current = false;
    isUserScrolledUpRef.current = true;
    setIsUserScrolledUp(true);
    const didLoad = await loadOlderMessages(container);
    if (!didLoad) topLoadArmedRef.current = true;
  }, [hasMoreMessages, isNearBottom, loadOlderMessages, revealNewer, revealOlderRows]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const restore = pendingScrollRestoreRef.current;
    applyScrollRestore(container, restore);
    pendingScrollRestoreRef.current = null;
    settlingScrollRestoreRef.current = restore;
    if (scrollRestoreReleaseTimerRef.current) clearTimeout(scrollRestoreReleaseTimerRef.current);
    scrollRestoreReleaseTimerRef.current = setTimeout(() => {
      settlingScrollRestoreRef.current = null;
      scrollRestoreReleaseTimerRef.current = null;
    }, 2000);

    if (!hasMoreMessages && windowStartRef.current === 0) return;
    if (container.scrollTop >= topLoadRearmDistance(container)) {
      topLoadArmedRef.current = true;
      chainedPageSizeRef.current = MESSAGES_PER_PAGE;
      return;
    }

    // Some provider rows collapse into an already-rendered tool call and add
    // little or no visible height. Fetch another page in a controlled chain so
    // the reader always gets enough distance to scroll before the next load;
    // each link doubles, since every commit restyles the whole list.
    const pageSize = Math.min(chainedPageSizeRef.current * 2, MAX_CHAINED_PAGE);
    chainedPageSizeRef.current = pageSize;
    const frame = requestAnimationFrame(() => {
      if (pendingScrollRestoreRef.current || isLoadingMoreRef.current) return;
      if (revealOlderRows(container, pageSize)) return;
      void loadOlderMessages(container, pageSize).then((didLoad) => {
        if (!didLoad) topLoadArmedRef.current = true;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRestoreTick, hasMoreMessages, loadOlderMessages, revealOlderRows]);

  // Reset scroll/pagination state on session change
  useLayoutEffect(() => {
    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    setViewRange(null);
    topLoadArmedRef.current = true;
    chainedPageSizeRef.current = MESSAGES_PER_PAGE;
    capturedScrollRestoreRef.current = null;
    pendingScrollRestoreRef.current = null;
    cancelSettlingScrollRestore();
    isUserScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    // A selection in the previous session must not hold or widen this one's window.
    hasChatSelectionRef.current = false;
    selectionStartIndexRef.current = null;
    setSelectionStartIndex(null);
    document.documentElement.classList.remove('chat-text-selected');
  }, [cancelSettlingScrollRestore, selectedProject?.projectId, selectedSession?.id]);

  // Establish the initial bottom position synchronously after the first page
  // renders. A ResizeObserver below keeps that bottom anchor authoritative as
  // markdown, code blocks, fonts, images, and tool cards finish laying out.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingSessionMessages || chatMessages.length === 0) return;
    if (searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = false;
      return;
    }

    if (pendingInitialScrollRef.current) {
      container.scrollTop = container.scrollHeight;
      pendingInitialScrollRef.current = false;
      isUserScrolledUpRef.current = false;
      setIsUserScrolledUp(false);
    }

    // If the newest page is shorter than the viewport, reaching the top emits
    // no scroll event at all. Proactively fill through older/collapsed pages so
    // an undersized first page cannot become another dead roof.
    if (
      hasMoreMessages
      && !isUserScrolledUpRef.current
      && container.scrollTop < topLoadDistance(container)
      && topLoadArmedRef.current
    ) {
      topLoadArmedRef.current = false;
      void loadOlderMessages(container).then((didLoad) => {
        if (!didLoad) topLoadArmedRef.current = true;
      });
    }
  }, [
    chatMessages.length,
    hasMoreMessages,
    isLoadingSessionMessages,
    loadOlderMessages,
    selectedProject?.projectId,
    selectedSession?.id,
    viewRange,
    visibleMessageCount,
  ]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      // ResizeObserver runs after layout and before paint. Restore immediately:
      // deferring through requestAnimationFrame exposes one incorrect frame in
      // which a newly prepended assistant header can flash at the roof before
      // late markdown/tool layout pushes it out of view.
      const restore = settlingScrollRestoreRef.current;
      if (restore) {
        applyScrollRestore(container, restore);
        return;
      }
      if (
        !isUserScrolledUpRef.current
        && !isViewDetachedRef.current
        && !searchScrollActiveRef.current
        && !isLoadingMoreRef.current
        && !hasChatSelectionRef.current
      ) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [pageScroll, selectedProject?.projectId, selectedSession?.id]);

  // Main session loading effect — store-based
  useEffect(() => {
    let cancelled = false;

    if (!selectedSession?.id || !selectedProject?.projectId) {
      // A freshly created session can be mid-run before the router has a
      // canonical selectedSession (the URL effect synthesizes one on the
      // next render). Keep the active view intact instead of wiping it.
      if (currentSessionIdRef.current && processingSessionsRef.current?.has(currentSessionIdRef.current)) {
        return;
      }

      resetStreamingState();
      currentSessionIdRef.current = null;
      setCurrentSessionId(null);
      setTokenBudget(null);
      return;
    }

    const requestedSessionId = selectedSession.id;

    const subscribeToSelectedSession = () => {
      if (!ws) {
        return;
      }

      statusCheckSentAtRef.current.set(requestedSessionId, Date.now());
      const progress = getReplayProgress(requestedSessionId);
      sendMessage({
        type: 'chat.subscribe',
        sessions: [{
          sessionId: requestedSessionId,
          lastSeq: progress?.seq ?? 0,
          runId: progress?.runId ?? null,
        }],
      });
    };

    const sessionChanged = currentSessionIdRef.current !== null && currentSessionIdRef.current !== requestedSessionId;
    if (sessionChanged) {
      resetStreamingState();
    }

    // Reset pagination/scroll state
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setViewRange(null);
    setAllMessagesLoaded(false);
    setIsLoadingAllMessages(false);
    setViewHiddenCount(0);

    if (sessionChanged) {
      setTokenBudget(null);
    }

    currentSessionIdRef.current = requestedSessionId;
    setCurrentSessionId(requestedSessionId);

    // Subscribe to the session's live run (if any): the ack reconciles the
    // processing indicator, re-attaches a mid-flight stream to this socket,
    // and replays any live events missed since `lastSeq`. Recording the send
    // time lets the ack handler discard idle acks that a newer request has
    // since outdated.
    subscribeToSelectedSession();

    // Switching back to a recently viewed session should be instant. The old
    // guard only reused the cache when the same session was already selected,
    // forcing a needless full transcript parse on every A -> B -> A switch.
    const cachedSlot = sessionStore.getSessionSlot(requestedSessionId);
    // A slot left on a jumped-to window reopens at the latest messages instead.
    if (cachedSlot && !sessionStore.isStale(requestedSessionId) && cachedSlot.status !== 'error' && !cachedSlot.hasNewer) {
      setAllMessagesLoaded(!cachedSlot.hasMore);
      if (cachedSlot.tokenUsage) setTokenBudget(cachedSlot.tokenUsage as Record<string, unknown>);
      setIsLoadingSessionMessages(false);
      return;
    }

    // Fetch from server → store updates → chatMessages re-derives automatically
    setIsLoadingSessionMessages(true);
    void sessionStore.fetchFromServer(requestedSessionId, {
      limit: MESSAGES_PER_PAGE,
      offset: 0,
    }).then(slot => {
      if (cancelled) return;
      if (slot) {
        if (slot.tokenUsage) setTokenBudget(slot.tokenUsage as Record<string, unknown>);
      }
      setIsLoadingSessionMessages(false);
    }).catch(() => {
      if (cancelled) return;
      setIsLoadingSessionMessages(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    resetStreamingState,
    selectedProject?.projectId,
    selectedSession?.id,
    sendMessage,
    statusCheckSentAtRef,
    getReplayProgress,
    ws,
    sessionStore,
  ]);

  // External message update (e.g. WebSocket reconnect, background refresh)
  useEffect(() => {
    if (!externalMessageUpdate || !selectedSessionId || !selectedProject?.projectId) return;

    if (externalUpdateTargetRef.current.version !== externalMessageUpdate) {
      externalUpdateTargetRef.current = {
        version: externalMessageUpdate,
        sessionId: selectedSessionId,
      };
    }

    const target = externalUpdateTargetRef.current;
    if (
      target.sessionId !== selectedSessionId
      || target.version <= handledExternalUpdateRef.current
      || isLoadingSessionMessages
      || isLoadingAllMessages
      || isProcessing
    ) return;

    // Claim this watcher version before starting the request. Object identity
    // changes and processing transitions must not launch the same refresh again.
    handledExternalUpdateRef.current = target.version;

    const reloadExternalMessages = async () => {
      try {
        await sessionStore.refreshFromServer(selectedSessionId);

        if (isNearBottom() && !isViewDetachedRef.current) {
          setTimeout(() => scrollToBottom(), 200);
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    externalMessageUpdate,
    isLoadingSessionMessages,
    isLoadingAllMessages,
    isNearBottom,
    isProcessing,
    scrollToBottom,
    selectedProject?.projectId,
    selectedSessionId,
    sessionStore,
  ]);

  // Search navigation target
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      });
    }
  }, [selectedSession]);

  // Scroll to search target: located in the text index, reached by a jump.
  useEffect(() => {
    if (!searchTarget || chatMessages.length === 0 || isLoadingSessionMessages || !activeSessionId) return;

    const target = searchTarget;
    const sessionId = activeSessionId;
    setSearchTarget(null);

    void (async () => {
      try {
        const slot = sessionStore.getSessionSlot(sessionId);
        const records = slot && !slot.hasMore && !slot.hasNewer
          ? sessionStore.getMessages(sessionId)
          : await sessionStore.fetchFindText(sessionId);
        if (currentSessionIdRef.current !== sessionId) return;
        const record = locateSearchTarget(records, target);
        if (!record) return;
        const messageId = chatFindEntriesForRecord(record)[0]?.messageId ?? record.id;
        if (await jumpToMessageRef.current({ messageId, recordId: record.id })) setFlashTargetId(messageId);
      } catch {
        // The chat stays at its latest messages.
      } finally {
        searchScrollActiveRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const requestedSessionId = selectedSession.id;
    let cancelled = false;
    const fetchInitialTokenUsage = async () => {
      try {
        // The provider module resolves storage and provider details from the session id.
        const url = `/api/providers/sessions/${encodeURIComponent(requestedSessionId)}/token-usage`;
        const response = await authenticatedFetch(url);
        if (cancelled) return;
        if (response.ok) {
          const payload = await response.json();
          if (cancelled) return;
          setTokenBudget(payload.data ?? null);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
    // Only the session on screen may drive the composer's usage wheel; a slow
    // response for the session just left must not land on its replacement.
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.id]);

  // Fetch this session's own model and effort on switch.
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id) {
      return;
    }
    const provider = selectedSession.__provider ?? 'claude';
    sessionStore.fetchSessionSettings(selectedSession.id, provider);
  }, [selectedProject, selectedSession?.id, selectedSession?.__provider, sessionStore]);

  const chatMessageCountRef = useRef(chatMessages.length);
  chatMessageCountRef.current = chatMessages.length;

  const viewBounds = useMemo(() => {
    if (!viewRange) return null;
    const indexOf = (id: string) => chatMessages.findIndex((message) => message.id === id);
    const start = viewRange.startId === null ? 0 : indexOf(viewRange.startId);
    const last = viewRange.endId === null ? chatMessages.length - 1 : indexOf(viewRange.endId);
    return start < 0 || last < start ? null : { start, end: last + 1 };
  }, [chatMessages, viewRange]);
  // An anchor that left the loaded window (rewind, reload) returns to the tail window.
  useEffect(() => {
    if (viewRange && !viewBounds) setViewRange(null);
  }, [viewBounds, viewRange]);

  const windowStart = viewBounds ? viewBounds.start : Math.max(0, chatMessages.length - visibleMessageCount);
  const windowEnd = viewBounds ? viewBounds.end : chatMessages.length;
  const isViewDetached = viewBounds !== null || Boolean(activeSessionSlot?.hasNewer);
  viewRangeRef.current = viewBounds ? viewRange : null;
  windowStartRef.current = windowStart;
  windowEndRef.current = windowEnd;
  isViewDetachedRef.current = isViewDetached;
  chatMessagesRef.current = chatMessages;

  const visibleMessages = useMemo(() => {
    const start = selectionStartIndex === null ? windowStart : Math.min(windowStart, selectionStartIndex);
    return start === 0 && windowEnd === chatMessages.length ? chatMessages : chatMessages.slice(start, windowEnd);
  }, [chatMessages, selectionStartIndex, windowEnd, windowStart]);

  useEffect(() => {
    if (!flashTargetId) return;
    const row = Array.from(messagesContentRef.current?.querySelectorAll<HTMLElement>('.chat-message[data-chat-message-id]') ?? [])
      .find((element) => element.dataset.chatMessageId === flashTargetId);
    if (!row) return;
    setFlashTargetId(null);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    row.classList.add('search-highlight-flash');
    setTimeout(() => row.classList.remove('search-highlight-flash'), 4000);
  }, [flashTargetId, visibleMessages]);

  // Arrivals trim the oldest rendered message and scrolling follows new output;
  // either would move or destroy text the reader is selecting, so both wait.
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = document.getSelection();
      const content = messagesContentRef.current;
      const anchor = selection?.anchorNode ?? null;
      const selecting = Boolean(selection && !selection.isCollapsed && content && anchor && content.contains(anchor));
      if (selecting === hasChatSelectionRef.current) return;
      hasChatSelectionRef.current = selecting;
      document.documentElement.classList.toggle('chat-text-selected', selecting);

      if (selecting) {
        const start = windowStartRef.current;
        selectionStartIndexRef.current = start;
        setSelectionStartIndex(start);
        return;
      }
      const held = selectionStartIndexRef.current;
      selectionStartIndexRef.current = null;
      setSelectionStartIndex(null);
      if (held !== null && !viewRangeRef.current) {
        // Keep what was on screen instead of trimming it the moment the selection clears.
        setVisibleMessageCount((count) => Math.max(count, chatMessageCountRef.current - held));
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.documentElement.classList.remove('chat-text-selected');
    };
  }, []);

  // Scrolled up, new content lands below the viewport and the position holds on
  // its own; older messages arriving above are the scroll-restore path's job.
  // Reads the ref, not state: re-entering the bottom band mid-drag must not snap.
  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;
    if (isUserScrolledUpRef.current || isViewDetachedRef.current) return;

    setTimeout(() => {
      if (!hasChatSelectionRef.current) scrollToBottom();
    }, 50);
  }, [chatMessages.length, isLoadingMoreMessages, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let frame: number | null = null;

    const target = scrollEventTarget(container);
    const onScroll = () => {
      // A hidden chat collapses the page; that clamp is not the reader scrolling.
      if (messagesContentRef.current?.offsetParent === null) return;
      if (isPageScrollHost(container)) lastPageScrollTopRef.current = container.scrollTop;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        void handleScroll();
      });
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [handleScroll, pageScroll]);

  // The page is the scroller only while this chat shows on a phone. Returning
  // from another tab restores the reader's place, or rejoins the bottom when
  // they were following; a keyboard resize keeps a follower at the bottom.
  useLayoutEffect(() => {
    if (!pageScroll) return;
    const root = document.documentElement;

    if (!pendingInitialScrollRef.current) {
      const savedTop = lastPageScrollTopRef.current;
      root.scrollTop = isUserScrolledUpRef.current && savedTop !== null ? savedTop : root.scrollHeight;
    }

    const onResize = () => {
      if (isUserScrolledUpRef.current || hasChatSelectionRef.current || searchScrollActiveRef.current) return;
      root.scrollTop = root.scrollHeight;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pageScroll]);

  /** Renders rows around one message; false when it is not among `messages`. */
  const revealAround = useCallback((messages: ChatMessage[], messageId: string): boolean => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return false;
    const start = Math.max(0, index - JUMP_ROWS_AROUND);
    const end = Math.min(messages.length, index + JUMP_ROWS_AROUND + 1);
    pendingScrollRestoreRef.current = null;
    capturedScrollRestoreRef.current = null;
    cancelSettlingScrollRestore();
    isUserScrolledUpRef.current = true;
    setIsUserScrolledUp(true);
    setViewRange({
      startId: start === 0 ? null : messages[start].id ?? null,
      endId: end >= messages.length ? null : messages[end - 1].id ?? null,
    });
    return true;
  }, [cancelSettlingScrollRestore]);

  /**
   * Brings one message into the rendered rows without rendering what lies
   * between: loaded rows are revealed in place, anything else is fetched as
   * a window around it. Resolves false when the message cannot be found.
   */
  const jumpToMessage = useCallback(async ({ messageId, recordId }: ChatJumpTarget): Promise<boolean> => {
    const sessionId = activeSessionId;
    if (!sessionId) return false;
    const messages = chatMessagesRef.current;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index >= windowStartRef.current && index < windowEndRef.current) return true;
    if (index >= 0) return revealAround(messages, messageId);

    let found = false;
    const reveal = (slot: { merged: NormalizedMessage[] }) => {
      if (currentSessionIdRef.current !== sessionId) return;
      const converted = normalizedToChatMessages(slot.merged);
      found = revealAround(converted, messageId) || revealAround(converted, recordId);
    };
    const slot = await sessionStore.fetchAround(sessionId, recordId, { limit: JUMP_RECORDS, onBeforeNotify: reveal });
    // A live row not yet in the transcript is only in the tail window.
    if (!slot && sessionStore.getSessionSlot(sessionId)?.hasNewer) {
      await sessionStore.fetchFromServer(sessionId, { limit: MESSAGES_PER_PAGE, onBeforeNotify: reveal });
    }
    return found;
  }, [activeSessionId, revealAround, sessionStore]);
  jumpToMessageRef.current = jumpToMessage;

  const loadAllMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    if (!selectedSession || !selectedProject) return null;
    if (isLoadingAllMessages) return null;
    const requestSessionId = selectedSession.id;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);

    const container = scrollContainerRef.current;
    const scrollRestore = container ? captureScrollRestore(container) : null;
    capturedScrollRestoreRef.current = scrollRestore;

    try {
      // A complete cache can still have older rows hidden by the display limit.
      const slot = hasMoreMessages || sessionStore.getSessionSlot(requestSessionId)?.hasNewer
        ? await sessionStore.fetchFromServer(requestSessionId, { limit: null, offset: 0 })
        : sessionStore.getSessionSlot(requestSessionId);

      if (currentSessionIdRef.current !== requestSessionId) return null;

      if (slot && slot.status !== 'error' && !slot.hasMore) {
        if (scrollRestore) {
          pendingScrollRestoreRef.current = scrollRestore;
          capturedScrollRestoreRef.current = null;
          setScrollRestoreTick((tick) => tick + 1);
        }

        setViewRange(null);
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        const all = normalizedToChatMessages(sessionStore.getMessages(requestSessionId));
        return viewHiddenCount > 0 && viewHiddenCount < all.length
          ? all.slice(0, -viewHiddenCount)
          : all;
      }
      return null;
    } catch (error) {
      console.error('Error loading all messages:', error);
      return null;
    } finally {
      if (capturedScrollRestoreRef.current === scrollRestore) {
        capturedScrollRestoreRef.current = null;
      }
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [selectedSession, selectedProject, isLoadingAllMessages, hasMoreMessages, sessionStore, viewHiddenCount]);

  return {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    turnStartedAt,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    // Rows loaded but not rendered above count as hidden, as in the tail window.
    visibleMessageCount: viewBounds ? chatMessages.length - viewBounds.start : visibleMessageCount,
    visibleMessages,
    loadedRecords: storeMessages,
    isViewDetached,
    jumpToMessage,
    loadAllMessages,
    isLoadingAllMessages,
    createDiff,
    scrollContainerRef,
    messagesContentRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
  };
}
