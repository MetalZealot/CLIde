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
   * Stack mode (mobile) drives the browser history so the Android back gesture
   * pops a screen. Pane mode (desktop) selects without touching history —
   * there is no back affordance to serve.
   */
  mode: 'stack' | 'panes';
  onClose: () => void;
};

/** Marks the entries we own, so an unrelated popstate is not mistaken for ours. */
const HISTORY_MARKER = '__clideSettingsDepth';

/**
 * Owns the navigation stack plus its browser-history integration.
 *
 * The contract, from the IA spec: each push adds one history entry, each pop
 * consumes one, and closing from depth 2 unwinds *all* of them so the history
 * is not left holding stale settings states. Every downward transition goes
 * through `history.back()` and lands in the popstate handler, so there is
 * exactly one path that mutates the stack downward — the alternative, dispatching
 * on click *and* on popstate, double-pops the moment a real back gesture arrives.
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

  // Seed the stack whenever Settings opens, honouring a deep link. Opening
  // straight to a sub-screen still needs history entries beneath it, or the
  // first back gesture would close Settings from depth 2.
  useEffect(() => {
    if (!isOpen) return;

    const target = normalizeScreenId(initialScreenId);
    const seeded = settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'open', id: target });
    dispatch({ type: 'open', id: target });

    if (!usesHistory) return;
    for (let depth = 1; depth <= navDepth(seeded); depth += 1) {
      pushHistoryEntry(depth);
    }
  }, [initialScreenId, isOpen, pushHistoryEntry, usesHistory]);

  // If Settings is closed by any route that did not go through `close()` — an
  // Escape key, a parent state change — the entries we pushed are still on the
  // stack. Drop them, without treating the resulting popstate as a navigation.
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

      // A genuine back gesture. If it consumed one of ours, pop a screen;
      // otherwise the user has navigated out from under an open Settings, so
      // close rather than leaving a modal stranded over a different page.
      if (ownedEntriesRef.current > 0) {
        ownedEntriesRef.current -= 1;
        dispatch({ type: 'pop' });
        return;
      }

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
    goBack,
    close,
  }), [close, goBack, push, select, state]);
}
