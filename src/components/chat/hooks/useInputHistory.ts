import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import { safeLocalStorage } from '../utils/chatStorage';

/**
 * Shell-style input history for the composer: ArrowUp in an empty textarea
 * recalls messages previously sent in this project (newest first), ArrowDown
 * walks forward again and finally restores whatever draft was in the box
 * before recall.
 *
 * Scoped by project, the same key drafts use, so a fresh chat still recalls
 * what was typed in its siblings. Browser-local by design: what you retype on
 * one device is rarely what you typed on another, and the transcript already
 * travels.
 */

const STORAGE_KEY = 'chat-input-history';
const MAX_ENTRIES_PER_SCOPE = 100;
/** Scopes beyond this are evicted oldest-written-first, so storage cannot grow with every project ever opened. */
const MAX_SCOPES = 100;

type HistoryStore = Record<string, string[]>;

function readHistoryStore(): HistoryStore {
  const raw = safeLocalStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const store: HistoryStore = {};
    for (const [scope, entries] of Object.entries(parsed)) {
      if (Array.isArray(entries)) {
        store[scope] = entries.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function readInputHistory(scope: string | null): string[] {
  if (!scope) {
    return [];
  }
  return readHistoryStore()[scope] ?? [];
}

export function appendInputHistory(scope: string, text: string): void {
  const store = readHistoryStore();
  const entries = store[scope] ?? [];
  if (entries[entries.length - 1] === text) {
    return;
  }
  // Re-inserting moves the scope to the end of the object's key order, which
  // is what the eviction below treats as most-recently-used.
  delete store[scope];
  store[scope] = [...entries, text].slice(-MAX_ENTRIES_PER_SCOPE);
  const scopes = Object.keys(store);
  for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES))) {
    delete store[stale];
  }
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

type UseInputHistoryOptions = {
  /** Must also sync the send-time mirror (`inputValueRef`) with the new value. */
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** The project being composed into; recall is scoped to it. */
  scope: string | null;
};

export type HistoryNav = {
  /**
   * The entries being walked, snapshotted when recall starts: `index` is a
   * position in THIS array, so an append from another tab mid-recall cannot
   * shift what the arrows land on or displace the draft restore.
   */
  history: string[];
  /** Position in `history` the box currently shows. */
  index: number;
  /** What was in the box before recall started, restored by ArrowDown past the newest entry. */
  draft: string;
  /** The exact text injected; once the box differs the user has edited and the arrows are theirs again. */
  recalled: string;
};

/**
 * The whole arrow-key decision, as a pure function so it can be tested without
 * a rendered composer. `input` is null when the key was consumed but the box
 * should not change — walking past the oldest entry.
 */
export type HistoryResult =
  | { handled: false }
  | { handled: true; nav: HistoryNav | null; input: string | null };

const NOT_HANDLED: HistoryResult = { handled: false };

export function resolveHistoryNavigation(
  key: 'ArrowUp' | 'ArrowDown',
  value: string,
  nav: HistoryNav | null,
  readHistory: () => string[],
): HistoryResult {
  // Once the box differs from what was injected the user has edited it, and
  // the arrows go back to being theirs.
  const untouched = nav !== null && value === nav.recalled;

  if (key === 'ArrowUp') {
    // Only take over an empty box or an untouched recall.
    if (value !== '' && !untouched) {
      return NOT_HANDLED;
    }
    // A fresh read starts a recall; an in-progress one keeps walking its own
    // snapshot, so an append from another tab cannot shift what the arrows
    // land on.
    const history = untouched ? nav.history : readHistory();
    if (history.length === 0) {
      return NOT_HANDLED;
    }
    if (untouched && nav.index === 0) {
      return { handled: true, nav, input: null };
    }
    const index = untouched ? nav.index - 1 : history.length - 1;
    const draft = untouched ? nav.draft : value;
    const recalled = history[index];
    return { handled: true, nav: { history, index, draft, recalled }, input: recalled };
  }

  // ArrowDown only walks forward through an untouched recall.
  if (!untouched) {
    return NOT_HANDLED;
  }
  if (nav.index >= nav.history.length - 1) {
    return { handled: true, nav: null, input: nav.draft };
  }
  const index = nav.index + 1;
  const recalled = nav.history[index];
  return {
    handled: true,
    nav: { history: nav.history, index, draft: nav.draft, recalled },
    input: recalled,
  };
}

export function useInputHistory({ setInput, textareaRef, scope }: UseInputHistoryOptions) {
  // A ref, not state: it only changes inside key handlers and must not
  // re-render the composer.
  const navRef = useRef<HistoryNav | null>(null);
  const scopeRef = useRef(scope);

  // A recall position from one project means nothing in another.
  useEffect(() => {
    scopeRef.current = scope;
    navRef.current = null;
  }, [scope]);

  const recordSentMessage = useCallback((text: string) => {
    navRef.current = null;
    const targetScope = scopeRef.current;
    if (!targetScope || !text.trim()) {
      return;
    }
    appendInputHistory(targetScope, text);
  }, []);

  /** Returns true when the event drove history recall and needs no further handling. */
  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return false;
      }

      // The command and mention menus intercept before this handler runs, so
      // ArrowUp reaching here is never a menu selection.
      const result = resolveHistoryNavigation(
        event.key,
        event.currentTarget.value,
        navRef.current,
        () => readInputHistory(scopeRef.current),
      );
      if (!result.handled) {
        return false;
      }

      event.preventDefault();
      navRef.current = result.nav;
      if (result.input !== null) {
        const text = result.input;
        setInput(text);
        // The controlled update can leave the caret at its old offset; a
        // recalled message should be ready to extend at its end.
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(text.length, text.length);
        });
      }
      return true;
    },
    [setInput, textareaRef],
  );

  return { recordSentMessage, handleHistoryKeyDown };
}
