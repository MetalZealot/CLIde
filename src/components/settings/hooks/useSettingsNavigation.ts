import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  SETTINGS_NAV_ROOT,
  currentScreenId,
  isAtRoot,
  navDepth,
  parentScreenId,
  settingsNavReducer,
} from '../registry/navigation';
import { normalizeScreenId } from '../registry/registry';

type UseSettingsNavigationArgs = {
  isOpen: boolean;
  initialScreenId?: string | null;
  /**
   * Stack mode (mobile) drives browser history so the Android back gesture pops
   * a screen. Pane mode (desktop) selects without touching history.
   */
  mode: 'stack' | 'panes';
  onClose: () => void;
};

/** Marks the entries we own, so an unrelated popstate is not mistaken for ours. */
const HISTORY_MARKER = '__clideSettingsDepth';

/**
 * Owns the navigation stack plus its browser-history integration.
 *
 * The contract: opening Settings and each screen push add one history entry,
 * each pop consumes one, and closing unwinds *all* of them. Every downward
 * transition goes through browser history and lands in the popstate handler,
 * so exactly one path mutates the stack downward.
 */
export function useSettingsNavigation({
  isOpen,
  initialScreenId,
  mode,
  onClose,
}: UseSettingsNavigationArgs) {
  const [state, dispatch] = useReducer(settingsNavReducer, SETTINGS_NAV_ROOT);

  /** How many history entries this hook has pushed and still owns. */
  const ownedEntriesRef = useRef(0);
  /** What the in-flight `history.go(-n)` is for, if anything. */
  const unwindIntentRef = useRef<'close' | 'cleanup' | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const usesHistory = mode === 'stack';

  const pushHistoryEntry = useCallback((depth: number) => {
    if (typeof window === 'undefined') return;
    window.history.pushState({ [HISTORY_MARKER]: depth }, '');
    ownedEntriesRef.current += 1;
  }, []);

  // Seed the stack whenever Settings opens, honouring a deep link. The root
  // entry makes Back close Settings without leaving the app; deeper screens
  // each add one entry above it.
  useEffect(() => {
    if (!isOpen) return;

    const target = normalizeScreenId(initialScreenId);
    const seeded = settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'open', id: target });
    dispatch({ type: 'open', id: target });

    if (!usesHistory) return;
    pushHistoryEntry(0);
    for (let depth = 1; depth <= navDepth(seeded); depth += 1) {
      pushHistoryEntry(depth);
    }
  }, [initialScreenId, isOpen, pushHistoryEntry, usesHistory]);

  // If Settings is closed by a route that did not go through `close()` — Escape,
  // a parent state change — our pushed entries are still on the stack. Drop them
  // without treating the resulting popstate as a navigation.
  useEffect(() => {
    if (isOpen || !usesHistory) return;
    if (ownedEntriesRef.current === 0) return;

    unwindIntentRef.current = 'cleanup';
    window.history.go(-ownedEntriesRef.current);
  }, [isOpen, usesHistory]);

  useEffect(() => {
    if (!isOpen || !usesHistory || typeof window === 'undefined') {
      return undefined;
    }

    const handlePopState = () => {
      const intent = unwindIntentRef.current;

      // `history.go(-n)` fires a single popstate however many entries it spans,
      // so one event finishes the whole unwind.
      if (intent) {
        unwindIntentRef.current = null;
        ownedEntriesRef.current = 0;
        dispatch({ type: 'reset' });
        if (intent === 'close') {
          onCloseRef.current();
        }
        return;
      }

      // A genuine back gesture. The final owned entry is the Settings root
      // guard, so consuming it closes the overlay instead of leaving the app.
      if (ownedEntriesRef.current > 0) {
        ownedEntriesRef.current -= 1;
        if (ownedEntriesRef.current === 0) {
          dispatch({ type: 'reset' });
          onCloseRef.current();
          return;
        }
        dispatch({ type: 'pop' });
        return;
      }

      // The user navigated out from under an open Settings overlay.
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isOpen, usesHistory]);

  const push = useCallback((id: string) => {
    const next = settingsNavReducer(state, { type: 'push', id });
    if (next === state) return;

    dispatch({ type: 'push', id });
    if (usesHistory) {
      pushHistoryEntry(navDepth(next));
    }
  }, [pushHistoryEntry, state, usesHistory]);

  /** Desktop selection: replace the stack outright, no history involved. */
  const select = useCallback((id: string | null) => {
    dispatch({ type: 'open', id });
  }, []);

  /**
   * Jump straight to a screen at any depth, expanding its ancestors — what a
   * search result needs, since `push` only accepts a child of the current screen.
   *
   * Search is only offered at the root list, so this is reached with only the
   * root guard owned and seeds the whole path as a deep link does.
   */
  const jumpTo = useCallback((id: string) => {
    const next = settingsNavReducer(state, { type: 'open', id });
    if (next.stack.length === 0) return;

    dispatch({ type: 'open', id });

    if (!usesHistory) return;
    for (let depth = ownedEntriesRef.current; depth <= next.stack.length; depth += 1) {
      pushHistoryEntry(depth);
    }
  }, [pushHistoryEntry, state, usesHistory]);

  const goBack = useCallback(() => {
    if (isAtRoot(state)) return;

    if (usesHistory && ownedEntriesRef.current > 0) {
      // The popstate handler performs the pop; see the note on this hook.
      window.history.back();
      return;
    }

    dispatch({ type: 'pop' });
  }, [state, usesHistory]);

  const close = useCallback(() => {
    if (usesHistory && ownedEntriesRef.current > 0) {
      unwindIntentRef.current = 'close';
      window.history.go(-ownedEntriesRef.current);
      return;
    }

    dispatch({ type: 'reset' });
    onCloseRef.current();
  }, [usesHistory]);

  return useMemo(() => ({
    stack: state.stack,
    depth: navDepth(state),
    screenId: currentScreenId(state),
    parentId: parentScreenId(state),
    atRoot: isAtRoot(state),
    push,
    select,
    jumpTo,
    goBack,
    close,
  }), [close, goBack, jumpTo, push, select, state]);
}
