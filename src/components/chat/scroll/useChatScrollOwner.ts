import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';

import { getChatViewportRect, scrollEventTarget } from '../utils/chatScrollHost';

import {
  followTop,
  holdTop,
  jumpTop,
  modeAfterReaderScroll,
  pickHold,
  readerInputCurrent,
  scrollCause,
  shiftBesideReader,
  toggleKeepsFollow,
  CHAT_SCROLL_TOGGLE_EVENT,
  type Edge,
  type ScrollModeKind,
  type Span,
} from './scrollRules';
import { scrollLog } from './scrollLog';

type Mode =
  | { kind: 'follow' }
  | { kind: 'read'; element: Element | null; edge: Edge; offset: number }
  | { kind: 'jump'; locate: () => Span | null; align: 'center' | 'ifNeeded' };

export interface ChatScrollOwner {
  /** False once the reader has scrolled up, jumped or opened a card: the jump button shows. */
  isFollowing: boolean;
  modeRef: MutableRefObject<{ kind: ScrollModeKind }>;
  follow(reason: string): void;
  jumpTo(locate: () => Span | null, align: 'center' | 'ifNeeded', reason: string): void;
  /** Puts the view back where the mode says, after rows or sizes changed. */
  reapply(reason: string): void;
  /** A new session opens following. */
  reset(): void;
}

const NAVIGATION_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Tab']);
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The only writer of the chat's scroll position. It is always following the bottom, holding the row
 * the reader is on, or holding a jump target; only the reader's own scrolling changes the mode, and
 * every change of rows or sizes re-applies it before paint.
 */
export function useChatScrollOwner({
  hostRef,
  contentRef,
  pageScroll,
  detachedRef,
  suspendedRef,
  onScroll,
}: {
  /** The pane, or the document root when the page scrolls. */
  hostRef: MutableRefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement>;
  pageScroll: boolean;
  /** The rendered window does not reach the newest message, so it cannot be followed. */
  detachedRef: MutableRefObject<boolean>;
  /** A text selection is active: nothing moves. */
  suspendedRef: MutableRefObject<boolean>;
  /** Every scroll, after the owner has read it; paging decides from here. */
  onScroll: () => void;
}): ChatScrollOwner {
  const modeRef = useRef<Mode>({ kind: 'follow' });
  const [isFollowing, setIsFollowing] = useState(true);
  const lastRef = useRef({ top: 0, height: 0 });
  const wroteRef = useRef<number | null>(null);
  const inputAtRef = useRef(0);
  /** A finger or pointer is down on the chat: scrolls are the reader's however long it rests. */
  const pressedRef = useRef(false);
  const readerScrollAtRef = useRef(0);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const shown = () => Boolean(hostRef.current) && contentRef.current?.offsetParent !== null;
  const rows = () => Array.from(contentRef.current?.querySelectorAll<HTMLElement>(':scope > .chat-message') ?? []);

  const setMode = useCallback((mode: Mode, reason: string) => {
    const changed = mode.kind !== modeRef.current.kind;
    modeRef.current = mode;
    if (changed) {
      setIsFollowing(mode.kind === 'follow');
      scrollLog('mode', `${mode.kind} ${reason}`);
    }
  }, []);

  /** The row the reader is on now, found by halving: rows are in vertical order. */
  const readingPosition = useCallback((): Mode => {
    const host = hostRef.current;
    const list = rows();
    if (!host || list.length === 0) return { kind: 'read', element: null, edge: 'top', offset: 0 };
    const band = getChatViewportRect(host);
    let low = 0;
    let high = list.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle].getBoundingClientRect().bottom > band.top) high = middle;
      else low = middle + 1;
    }
    const hold = pickHold([list[low].getBoundingClientRect()], band);
    return hold ? { kind: 'read', element: list[low], edge: hold.edge, offset: hold.offset } : { kind: 'read', element: null, edge: 'top', offset: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = useCallback((top: number, reason: string) => {
    const host = hostRef.current!;
    const before = host.scrollTop;
    // eslint-disable-next-line no-restricted-syntax -- the one writer
    host.scrollTop = top;
    const after = host.scrollTop;
    wroteRef.current = after;
    lastRef.current = { top: after, height: host.scrollHeight };
    scrollLog('write', `${modeRef.current.kind} ${reason} ${Math.round(before)}->${Math.round(after)} h=${host.scrollHeight}`);
  }, [hostRef]);

  /**
   * Reads where the view is now and what moved it since the owner last looked. Runs on every scroll
   * event and before every re-apply, so a reader's scroll that lands between a change of rows and its
   * scroll event is kept, never undone.
   */
  const observe = useCallback((host: HTMLElement): 'owner' | 'reader' | 'content' | 'still' => {
    const top = host.scrollTop;
    const height = host.scrollHeight;
    const last = lastRef.current;
    if (Math.abs(top - last.top) < 1) { lastRef.current = { top, height }; return 'still'; }
    const now = performance.now();
    const cause = scrollCause({
      top, lastTop: last.top, wrote: wroteRef.current,
      readerInput: readerInputCurrent(now, { pressed: pressedRef.current, inputAt: inputAtRef.current, readerScrollAt: readerScrollAtRef.current }),
    });
    lastRef.current = { top, height };
    if (cause === 'reader') {
      wroteRef.current = null;
      readerScrollAtRef.current = now;
      // Content that moved in the same frame as the reader's scroll is put back before the new hold is read.
      const mode = modeRef.current;
      if (mode.kind === 'read' && mode.element?.isConnected && !suspendedRef.current) {
        const shift = shiftBesideReader(mode.element.getBoundingClientRect()[mode.edge], getChatViewportRect(host), mode.offset, top - last.top);
        if (Math.abs(shift) >= 1) write(top + shift, 'reader-shift');
      }
      const kind = modeAfterReaderScroll(modeRef.current.kind, {
        delta: top - last.top, distanceToBottom: host.scrollHeight - host.scrollTop - host.clientHeight, detached: detachedRef.current,
      });
      const why = `reader ${Math.round(last.top)}->${Math.round(top)} h=${last.height}->${height} client=${host.clientHeight}`;
      if (kind === 'follow') setMode({ kind: 'follow' }, why);
      else setMode(readingPosition(), why);
    }
    return cause;
  }, [detachedRef, readingPosition, setMode, suspendedRef, write]);

  const reapply = useCallback((reason: string) => {
    const host = hostRef.current;
    if (!host || !shown() || suspendedRef.current) return;
    observe(host);
    // Every geometry read precedes the one write.
    const top = host.scrollTop;
    const height = host.scrollHeight;
    const mode = modeRef.current;
    let target: number | null = null;
    if (mode.kind === 'follow') {
      target = followTop(height, host.clientHeight);
    } else if (mode.kind === 'read') {
      if (!mode.element?.isConnected) {
        modeRef.current = readingPosition();
      } else {
        target = holdTop(top, mode.element.getBoundingClientRect()[mode.edge], getChatViewportRect(host), mode.offset);
      }
    } else {
      const span = mode.locate();
      if (span) target = jumpTop(top, span, getChatViewportRect(host), mode.align);
    }
    if (target !== null && Math.abs(target - top) >= 1) write(target, reason);
    else lastRef.current = { top, height };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef, observe, readingPosition, suspendedRef, write]);

  const follow = useCallback((reason: string) => {
    setMode({ kind: 'follow' }, reason);
    reapply(reason);
  }, [reapply, setMode]);

  const jumpTo = useCallback((locate: () => Span | null, align: 'center' | 'ifNeeded', reason: string) => {
    setMode({ kind: 'jump', locate, align }, reason);
    reapply(reason);
  }, [reapply, setMode]);

  const reset = useCallback(() => {
    wroteRef.current = null;
    setMode({ kind: 'follow' }, 'session');
  }, [setMode]);

  // Scroll and reader input: the reader's own scroll is the only thing that changes the mode.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const target = scrollEventTarget(host);
    const markInput = () => { inputAtRef.current = performance.now(); wroteRef.current = null; };
    const onKey = (event: KeyboardEvent) => { if (NAVIGATION_KEYS.has(event.key) && !isEditable(event.target)) markInput(); };
    const press = () => { pressedRef.current = true; markInput(); };
    // The scrollbar, or a drag in the rows (selection autoscroll); not the bars around a page-mode chat.
    const onPointer = (event: PointerEvent) => {
      if (event.target === host || (event.target instanceof Node && contentRef.current?.contains(event.target))) press();
    };
    // A release starts a fling or a smooth scroll, which the input window and the fling gap then cover.
    const release = () => { if (pressedRef.current) { pressedRef.current = false; markInput(); } };
    const onScrollEvent = () => {
      // A hidden chat collapses the page; that clamp is not the reader.
      if (!shown()) return;
      const cause = observe(host);
      if (cause === 'owner') wroteRef.current = null;
      else if (cause === 'content') reapply('clamp');
      onScrollRef.current();
    };
    target.addEventListener('scroll', onScrollEvent, { passive: true });
    target.addEventListener('wheel', markInput, { passive: true });
    target.addEventListener('touchstart', press, { passive: true });
    target.addEventListener('touchmove', markInput, { passive: true });
    window.addEventListener('keydown', onKey);
    host.addEventListener('pointerdown', onPointer);
    for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) window.addEventListener(type, release, true);
    lastRef.current = { top: host.scrollTop, height: host.scrollHeight };
    return () => {
      target.removeEventListener('scroll', onScrollEvent);
      target.removeEventListener('wheel', markInput);
      target.removeEventListener('touchstart', press);
      target.removeEventListener('touchmove', markInput);
      window.removeEventListener('keydown', onKey);
      host.removeEventListener('pointerdown', onPointer);
      for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) window.removeEventListener(type, release, true);
      pressedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observe, pageScroll, reapply]);

  // Sizes: the rows, the scroller and the bars around it. Observers run after layout and before paint.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => reapply('resize'));
    observer.observe(content);
    if (pageScroll) {
      for (const edge of document.querySelectorAll('[data-chat-page-top], [data-chat-page-bottom], [data-chat-page-nav]')) observer.observe(edge);
    } else {
      observer.observe(host);
    }
    const onViewport = () => reapply('viewport');
    window.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('resize', onViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('resize', onViewport);
    };
  }, [contentRef, hostRef, pageScroll, reapply]);

  // A card about to open or close: the last card while following keeps the end; any other holds its header.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const onToggle = (event: Event) => {
      const button = event.target instanceof Element ? event.target : null;
      const host = hostRef.current;
      if (!button || !host) return;
      const list = rows().filter((row) => !row.hasAttribute('data-chat-activity-line'));
      const isLast = list.length > 0 && list[list.length - 1].contains(button);
      if (toggleKeepsFollow(modeRef.current.kind, isLast)) return;
      setMode({ kind: 'read', element: button, edge: 'top', offset: button.getBoundingClientRect().top - getChatViewportRect(host).top }, 'toggle');
    };
    content.addEventListener(CHAT_SCROLL_TOGGLE_EVENT, onToggle);
    return () => content.removeEventListener(CHAT_SCROLL_TOGGLE_EVENT, onToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRef, hostRef, pageScroll, setMode]);

  const publicModeRef = modeRef as MutableRefObject<{ kind: ScrollModeKind }>;
  return useMemo(() => ({ isFollowing, modeRef: publicModeRef, follow, jumpTo, reapply, reset }),
    [follow, isFollowing, jumpTo, publicModeRef, reapply, reset]);
}
