/**
 * The Settings navigation stack, as a pure reducer.
 *
 * Kept free of React and of history/DOM concerns so it can be unit-tested
 * directly; `useSettingsNavigation` owns the browser-history glue and is the
 * only place that knows a back gesture exists.
 *
 * Depth 0 is the root list and is represented by an empty stack. The last entry
 * is always the screen on display.
 */

import { MAX_SETTINGS_DEPTH, getScreen, getScreenPath } from './registry';

export type SettingsNavState = {
  stack: string[];
};

export type SettingsNavAction =
  /** Drill one level down, from the root list or from a screen to its child. */
  | { type: 'push'; id: string }
  /** Go back one level. A no-op at the root. */
  | { type: 'pop' }
  /** Jump straight to a screen (deep link), expanding its ancestors. */
  | { type: 'open'; id: string | null }
  /** Return to the root list. */
  | { type: 'reset' };

export const SETTINGS_NAV_ROOT: SettingsNavState = { stack: [] };

export const navDepth = (state: SettingsNavState): number => state.stack.length;

export const currentScreenId = (state: SettingsNavState): string | null => (
  state.stack.length ? state.stack[state.stack.length - 1] : null
);

export const isAtRoot = (state: SettingsNavState): boolean => state.stack.length === 0;

/** The screen a back step would land on, or null if that is the root list. */
export const parentScreenId = (state: SettingsNavState): string | null => (
  state.stack.length > 1 ? state.stack[state.stack.length - 2] : null
);

export function settingsNavReducer(
  state: SettingsNavState,
  action: SettingsNavAction,
): SettingsNavState {
  switch (action.type) {
    case 'push': {
      const screen = getScreen(action.id);

      // Unknown ids, over-deep pushes, and pushing a screen that is not a child
      // of the current one are all no-ops rather than corrupting the stack.
      if (!screen || state.stack.length >= MAX_SETTINGS_DEPTH) {
        return state;
      }

      const expectedParent = currentScreenId(state);
      if ((screen.parent ?? null) !== expectedParent) {
        return state;
      }

      return { stack: [...state.stack, screen.id] };
    }

    case 'pop': {
      if (isAtRoot(state)) {
        return state;
      }

      return { stack: state.stack.slice(0, -1) };
    }

    case 'open': {
      if (!action.id) {
        return SETTINGS_NAV_ROOT;
      }

      const path = getScreenPath(action.id);
      // An unknown id opens the root rather than throwing at a call site that
      // may be a stale deep link.
      return path.length ? { stack: path } : SETTINGS_NAV_ROOT;
    }

    case 'reset':
      return SETTINGS_NAV_ROOT;

    default:
      return state;
  }
}
