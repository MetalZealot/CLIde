/**
 * Settings search: the query → destinations matcher.
 *
 * Pure and React-free like the rest of `registry/`, so it is unit-tested without
 * a renderer. Labels arrive through a `translate` callback rather than an i18n
 * import, which is also what lets the tests assert against the real `en` file.
 *
 * **Results are destinations, never settings.** A screen appears at most once,
 * even when several of its rows match, because the thing the user is going to do
 * with a result is navigate to it. When the match came from a row rather than
 * from the screen's own name, the row's label is carried along as the reason —
 * that is what makes "minimap" land on Code Editor and say why.
 */

import { SETTINGS_SCREENS, getScreen, getScreenPath } from './registry';
import { SETTINGS_SEARCH_ENTRIES } from './searchIndex';
import type { SettingsSearchEntry } from './searchIndex';

export type SettingsTranslate = (key: string) => string;

export type SettingsSearchResult = {
  screenId: string;
  /** Ancestor label keys, outermost first: `['Claude']` for a Permissions hit. */
  ancestorLabelKeys: string[];
  /**
   * Setting labels that matched. Empty when the screen's own label, keywords or
   * ancestors matched — the screen name is then explanation enough.
   */
  matchedSettingLabelKeys: string[];
};

/**
 * Match tiers, best first. Ties inside a tier keep registry order, so the result
 * list is stable rather than reordering as the user types another character.
 */
const RANK_LABEL_PREFIX = 0;
const RANK_LABEL_CONTAINS = 1;
const RANK_KEYWORDS = 2;
const RANK_SETTING = 3;

const tokenize = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Every token must appear somewhere, so "enter send" matches "Enter to send". */
const matchesAll = (tokens: string[], haystack: string): boolean => (
  tokens.every((token) => haystack.includes(token))
);

const groupEntriesByScreen = (): Map<string, SettingsSearchEntry[]> => {
  const byScreen = new Map<string, SettingsSearchEntry[]>();

  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    const existing = byScreen.get(entry.screenId);
    if (existing) {
      existing.push(entry);
    } else {
      byScreen.set(entry.screenId, [entry]);
    }
  }

  return byScreen;
};

const ENTRIES_BY_SCREEN = groupEntriesByScreen();

export const getSearchEntriesForScreen = (screenId: string): SettingsSearchEntry[] => (
  ENTRIES_BY_SCREEN.get(screenId) ?? []
);

/** An empty or whitespace-only query returns no results, not every screen. */
export function searchSettings(query: string, translate: SettingsTranslate): SettingsSearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const collapsedQuery = tokens.join(' ');
  const ranked: { rank: number; order: number; result: SettingsSearchResult }[] = [];

  SETTINGS_SCREENS.forEach((screen, order) => {
    const label = translate(screen.labelKey).toLowerCase();
    const ancestorLabelKeys = getScreenPath(screen.id)
      .slice(0, -1)
      .map((id) => getScreen(id)?.labelKey ?? id);
    const ancestorLabels = ancestorLabelKeys.map((key) => translate(key).toLowerCase());

    let rank: number | null = null;

    if (label.startsWith(collapsedQuery)) {
      rank = RANK_LABEL_PREFIX;
    } else if (matchesAll(tokens, label)) {
      rank = RANK_LABEL_CONTAINS;
    } else if (matchesAll(tokens, [label, ...ancestorLabels, screen.keywords].join(' '))) {
      // Ancestors are in the haystack so "claude permissions" finds the
      // sub-screen whose own label is just "Permissions".
      rank = RANK_KEYWORDS;
    }

    // The screen's own name did not explain the hit, so find the rows that do.
    // This runs for keyword matches too, not only for rows-as-last-resort: a
    // keyword and a row label often overlap ("minimap"), and when they do the row
    // is the better explanation.
    let matchedSettingLabelKeys: string[] = [];
    if (rank === null || rank === RANK_KEYWORDS) {
      const hits = getSearchEntriesForScreen(screen.id).filter((entry) => {
        const own = [translate(entry.labelKey), entry.keywords ?? ''].join(' ').toLowerCase();

        // The row has to contribute something. Without this, a query the screen
        // already satisfies ("claude permissions") would list every row it has,
        // since the screen's own words are in each row's haystack.
        return tokens.some((token) => own.includes(token))
          && matchesAll(tokens, [own, label, ...ancestorLabels].join(' '));
      });

      matchedSettingLabelKeys = hits.map((entry) => entry.labelKey);

      if (rank === null && hits.length > 0) {
        rank = RANK_SETTING;
      }
    }

    if (rank !== null) {
      ranked.push({ rank, order, result: { screenId: screen.id, ancestorLabelKeys, matchedSettingLabelKeys } });
    }
  });

  ranked.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));

  return ranked.map((entry) => entry.result);
}

/**
 * The secondary line on a result row: where the screen lives, and — when the hit
 * came from a row — which row. Shared so the mobile list and the desktop rail
 * cannot describe the same result differently.
 */
export function describeSearchResult(
  result: SettingsSearchResult,
  translate: SettingsTranslate,
): string {
  const parts: string[] = [];

  if (result.ancestorLabelKeys.length > 0) {
    parts.push(result.ancestorLabelKeys.map(translate).join(' › '));
  }

  if (result.matchedSettingLabelKeys.length > 0) {
    parts.push(result.matchedSettingLabelKeys.map(translate).join(', '));
  }

  return parts.join(' · ');
}
