/**
 * The scroll owner's decisions, free of the DOM: who moved the view, which mode follows,
 * and where each mode puts the view. The rules are the design's
 * (docs/designs/chat-history-performance.md); each has a test in the chat hook tests.
 */

/** Dispatched (bubbling) by a card's toggle button just before it opens or closes. */
export const CHAT_SCROLL_TOGGLE_EVENT = 'chat-scroll-toggle';

/** Distance from the end within which a reader's downward scroll rejoins Following (taste, not a standard). */
export const FOLLOW_REJOIN_PX = 40;
/** Wheel, touch, pointer or key input this recent makes a scroll the reader's. */
export const READER_INPUT_WINDOW_MS = 1000;
/** A reader's scroll this soon after the last keeps a fling the reader's past the input window. */
export const FLING_GAP_MS = 150;

export type ScrollModeKind = 'follow' | 'read' | 'jump';
export type Edge = 'top' | 'bottom';
export interface Band { top: number; bottom: number }
export interface Span { top: number; bottom: number }

export interface ScrollEventFacts {
  top: number;
  /** Position when the owner last looked. */
  lastTop: number;
  /** The position the owner's last write produced, until a scroll event or reader input consumes it. */
  wrote: number | null;
  readerInput: boolean;
}

/** Who moved the view: only reader input makes it the reader; clamps and size changes are content. */
export function scrollCause(facts: ScrollEventFacts): 'owner' | 'reader' | 'content' {
  if (facts.wrote !== null && Math.abs(facts.top - facts.wrote) <= 1) return 'owner';
  if (Math.abs(facts.top - facts.lastTop) < 1) return 'content';
  return facts.readerInput ? 'reader' : 'content';
}

/** Reader input is current while a finger or pointer is down, within the input window, or while a fling keeps moving. */
export function readerInputCurrent(now: number, input: { pressed: boolean; inputAt: number; readerScrollAt: number }): boolean {
  return input.pressed || now - input.inputAt < READER_INPUT_WINDOW_MS || now - input.readerScrollAt < FLING_GAP_MS;
}

/** The mode after the reader's own scroll: up leaves Following; down into the bottom band rejoins it. */
export function modeAfterReaderScroll(
  kind: ScrollModeKind,
  scroll: { delta: number; distanceToBottom: number; detached: boolean },
): ScrollModeKind {
  if (scroll.delta < 0) return 'read';
  if (!scroll.detached && scroll.distanceToBottom <= FOLLOW_REJOIN_PX) return 'follow';
  return kind === 'follow' ? 'follow' : 'read';
}

/** The row the reader is on: the first in the band, by its top edge while that is visible, else its bottom. */
export function pickHold(rows: Span[], band: Band): { index: number; edge: Edge; offset: number } | null {
  const index = rows.findIndex((row) => row.bottom > band.top && row.top < band.bottom);
  if (index < 0) return null;
  const edge: Edge = rows[index].top >= band.top ? 'top' : 'bottom';
  return { index, edge, offset: rows[index][edge] - band.top };
}

/** The position that puts a held edge, now at `edgeNow`, back `offset` below the band top. */
export function holdTop(scrollTop: number, edgeNow: number, band: Band, offset: number): number {
  return scrollTop + (edgeNow - band.top - offset);
}

/** How far content moved a held edge beyond the reader's own scroll of `readerDelta` (rule 4). */
export function shiftBesideReader(edgeNow: number, band: Band, offset: number, readerDelta: number): number {
  return edgeNow - band.top - offset + readerDelta;
}

export function followTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/** Centres a target in the band, or puts one taller than the band at its top; `ifNeeded` leaves a visible one. */
export function jumpTop(scrollTop: number, target: Span, band: Band, align: 'center' | 'ifNeeded'): number | null {
  if (align === 'ifNeeded' && target.top >= band.top && target.bottom <= band.bottom) return null;
  if (target.bottom - target.top > band.bottom - band.top) return scrollTop + (target.top - band.top);
  return scrollTop + ((target.top + target.bottom) / 2 - (band.top + band.bottom) / 2);
}

/** Opening or closing a card: the last card while following keeps the end; any other card holds. */
export function toggleKeepsFollow(kind: ScrollModeKind, isLastRow: boolean): boolean {
  return kind === 'follow' && isLastRow;
}
