import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionIdle, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { ReplayProgress } from '../../../contexts/WebSocketContext';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';

import { normalizedToChatMessages } from './useChatMessages';

export const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;
const TOP_LOAD_THRESHOLD_PX = 100;
const TOP_LOAD_REARM_DISTANCE_PX = 140;

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
}

interface ScrollRestoreState {
  height: number;
  top: number;
  anchor: HTMLElement | null;
  anchorOffset: number | null;
}

function captureScrollRestore(container: HTMLDivElement): ScrollRestoreState {
  const containerRect = container.getBoundingClientRect();
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

function applyScrollRestore(container: HTMLDivElement, restore: ScrollRestoreState): void {
  if (restore.anchor?.isConnected && restore.anchorOffset !== null) {
    const currentOffset = restore.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += currentOffset - restore.anchorOffset;
  } else {
    container.scrollTop = restore.top + Math.max(container.scrollHeight - restore.height, 0);
  }

  restore.height = container.scrollHeight;
  restore.top = container.scrollTop;
}

function updateScrollRestoreTarget(container: HTMLDivElement, restore: ScrollRestoreState): void {
  if (restore.anchor?.isConnected) {
    restore.anchorOffset = restore.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
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

  const selectedSessionId = selectedSession?.id ?? null;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const isUserScrolledUpRef = useRef(false);
  isUserScrolledUpRef.current = isUserScrolledUp;
  const [searchTarget, setSearchTarget] = useState<{ timestamp?: string; uuid?: string; snippet?: string } | null>(null);
  const searchScrollActiveRef = useRef(false);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const topLoadArmedRef = useRef(true);
  const capturedScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const settlingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const scrollRestoreReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
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
    setAllMessagesLoaded(false);
    setIsLoadingAllMessages(false);
    setViewHiddenCount(0);
    setSearchTarget(null);
    searchScrollActiveRef.current = false;
    topLoadArmedRef.current = true;
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
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
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
          limit: MESSAGES_PER_PAGE,
          onBeforeNotify: (updatedSlot) => {
            const madeProgress =
              updatedSlot.offset > previousOffset
              || updatedSlot.serverMessages.length > previousServerMessageCount;
            if (!madeProgress) return;

            // The store notification and these local updates are automatically
            // batched by React 18. Older DOM rows, the larger visible window,
            // and the pending anchor therefore arrive in one commit, allowing
            // the layout effect to restore position before the browser paints.
            restoreWasArmed = true;
            pendingScrollRestoreRef.current = scrollRestore;
            capturedScrollRestoreRef.current = null;
            setScrollRestoreTick((tick) => tick + 1);
            setVisibleMessageCount((prev) => prev + MESSAGES_PER_PAGE);
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
          setVisibleMessageCount((prev) => prev + MESSAGES_PER_PAGE);
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

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const trackedRestore = capturedScrollRestoreRef.current ?? settlingScrollRestoreRef.current;
    if (trackedRestore) updateScrollRestoreTarget(container, trackedRestore);

    const nearBottom = isNearBottom();
    isUserScrolledUpRef.current = !nearBottom;
    setIsUserScrolledUp(!nearBottom);

    if (container.scrollTop >= TOP_LOAD_REARM_DISTANCE_PX) {
      topLoadArmedRef.current = true;
    }

    const scrolledNearTop = container.scrollTop < TOP_LOAD_THRESHOLD_PX;
    if (!scrolledNearTop || !hasMoreMessages) return;
    if (!topLoadArmedRef.current) return;

    // One request per arrival at the top. The restore effect re-arms only after
    // the prepend creates enough real scroll distance; collapsed transcript rows
    // are fetched through automatically instead of leaving a false "roof".
    topLoadArmedRef.current = false;
    isUserScrolledUpRef.current = true;
    setIsUserScrolledUp(true);
    const didLoad = await loadOlderMessages(container);
    if (!didLoad) topLoadArmedRef.current = true;
  }, [hasMoreMessages, isNearBottom, loadOlderMessages]);

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

    if (!hasMoreMessages) return;
    if (container.scrollTop >= TOP_LOAD_REARM_DISTANCE_PX) {
      topLoadArmedRef.current = true;
      return;
    }

    // Some provider rows collapse into an already-rendered tool call and add
    // little or no visible height. Fetch another page in a controlled chain so
    // the reader always gets enough distance to scroll before the next load.
    const frame = requestAnimationFrame(() => {
      if (!pendingScrollRestoreRef.current && !isLoadingMoreRef.current) {
        void loadOlderMessages(container).then((didLoad) => {
          if (!didLoad) topLoadArmedRef.current = true;
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRestoreTick, hasMoreMessages, loadOlderMessages]);

  // Reset scroll/pagination state on session change
  useLayoutEffect(() => {
    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    topLoadArmedRef.current = true;
    capturedScrollRestoreRef.current = null;
    pendingScrollRestoreRef.current = null;
    cancelSettlingScrollRestore();
    isUserScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
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
      && container.scrollTop < TOP_LOAD_THRESHOLD_PX
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
      if (!isUserScrolledUpRef.current && !searchScrollActiveRef.current && !isLoadingMoreRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [selectedProject?.projectId, selectedSession?.id]);

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
    if (cachedSlot && !sessionStore.isStale(requestedSessionId) && cachedSlot.status !== 'error') {
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
      || isProcessing
    ) return;

    // Claim this watcher version before starting the request. Object identity
    // changes and processing transitions must not launch the same refresh again.
    handledExternalUpdateRef.current = target.version;

    const reloadExternalMessages = async () => {
      try {
        await sessionStore.refreshFromServer(selectedSessionId);

        if (isNearBottom()) {
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

  // Scroll to search target
  useEffect(() => {
    if (!searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    setSearchTarget(null);

    const scrollToTarget = async () => {
      if (hasMoreMessages && selectedSession && selectedProject) {
          try {
            // Load all messages into the store for search navigation
            const slot = await sessionStore.fetchFromServer(selectedSession.id, {
              limit: null,
              offset: 0,
            });
            if (slot) {
              setVisibleMessageCount(Infinity);
              setAllMessagesLoaded(true);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch {
            // Fall through and scroll in current messages
          }
      }
      setVisibleMessageCount(Infinity);

      const findAndScroll = (retriesLeft: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let targetElement: Element | null = null;

        if (target.snippet) {
          const cleanSnippet = target.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '').trim();
          const searchPhrase = cleanSnippet.slice(0, 80).toLowerCase().trim();
          if (searchPhrase.length >= 10) {
            const messageElements = container.querySelectorAll('.chat-message');
            for (const el of messageElements) {
              const text = (el.textContent || '').toLowerCase();
              if (text.includes(searchPhrase)) { targetElement = el; break; }
            }
          }
        }

        if (!targetElement && target.timestamp) {
          const targetDate = new Date(target.timestamp).getTime();
          const messageElements = container.querySelectorAll('[data-message-timestamp]');
          let closestDiff = Infinity;
          for (const el of messageElements) {
            const ts = el.getAttribute('data-message-timestamp');
            if (!ts) continue;
            const diff = Math.abs(new Date(ts).getTime() - targetDate);
            if (diff < closestDiff) { closestDiff = diff; targetElement = el; }
          }
        }

        if (targetElement) {
          targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          targetElement.classList.add('search-highlight-flash');
          setTimeout(() => targetElement?.classList.remove('search-highlight-flash'), 4000);
          searchScrollActiveRef.current = false;
        } else if (retriesLeft > 0) {
          setTimeout(() => findAndScroll(retriesLeft - 1), 200);
        } else {
          searchScrollActiveRef.current = false;
        }
      };

      setTimeout(() => findAndScroll(15), 150);
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const fetchInitialTokenUsage = async () => {
      try {
        // The provider module resolves storage and provider details from the session id.
        const url = `/api/providers/sessions/${encodeURIComponent(selectedSession.id)}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          const payload = await response.json();
          setTokenBudget(payload.data ?? null);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedSession?.id]);

  // Fetch the active model for this session on switch.
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id) {
      return;
    }
    const provider = selectedSession.__provider ?? 'claude';
    sessionStore.fetchModel(selectedSession.id, provider);
  }, [selectedProject, selectedSession?.id, selectedSession?.__provider, sessionStore]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) return chatMessages;
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    scrollPositionRef.current = { height: container.scrollHeight, top: container.scrollTop };
  });

  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;

    if (!isUserScrolledUp) {
      setTimeout(() => scrollToBottom(), 50);
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;
    if (heightDiff > 0 && prevTop > 0) container.scrollTop = prevTop + heightDiff;
  }, [chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let frame: number | null = null;

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        void handleScroll();
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [handleScroll]);

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
      const slot = await sessionStore.fetchFromServer(requestSessionId, {
        limit: null,
        offset: 0,
      });

      if (currentSessionId !== requestSessionId) return null;

      if (slot && slot.status !== 'error') {
        if (scrollRestore) {
          pendingScrollRestoreRef.current = scrollRestore;
          capturedScrollRestoreRef.current = null;
          setScrollRestoreTick((tick) => tick + 1);
        }

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
  }, [selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore, viewHiddenCount]);

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
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
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
