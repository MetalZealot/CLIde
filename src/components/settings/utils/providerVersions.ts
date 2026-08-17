import type { ProviderRuntimeVersions } from '../../provider-auth/types';

/**
 * How the account card presents a provider's version pair, and when a move in
 * that pair is still worth mentioning.
 *
 * Kept free of React and i18n so both halves can be tested directly: the server
 * records the pair on every auth check, but only a *change* is news.
 */

/**
 * `previous` is kept indefinitely in the store, so without a window this notice
 * would become permanent furniture rather than a signal.
 */
export const VERSION_MOVE_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type VersionHalf = 'runtime' | 'sdk';

export type VersionMove = {
  half: VersionHalf;
  from: string | null;
  to: string | null;
};

/**
 * "2.1.233 · SDK 0.3.233". The runtime leads because it is the half that moves
 * on its own; either half may be missing, and both missing means no row.
 */
export const formatVersionPair = (versions: ProviderRuntimeVersions): string | null => {
  const parts = [versions.runtime, versions.sdk ? `SDK ${versions.sdk}` : null]
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
};

/** Which halves moved when the pair last changed, while that is still recent. */
export const describeVersionMoves = (
  versions: ProviderRuntimeVersions,
  now: number = Date.now(),
): VersionMove[] => {
  const previous = versions.previous;
  if (!previous) {
    return [];
  }

  const observedAt = Date.parse(versions.observedAt);
  if (Number.isNaN(observedAt) || now - observedAt > VERSION_MOVE_NOTICE_WINDOW_MS) {
    return [];
  }

  const moves: VersionMove[] = [];
  if (previous.runtime !== versions.runtime) {
    moves.push({ half: 'runtime', from: previous.runtime, to: versions.runtime });
  }
  if (previous.sdk !== versions.sdk) {
    moves.push({ half: 'sdk', from: previous.sdk, to: versions.sdk });
  }
  return moves;
};

/** Coarse age of the observation, in the same terse style as the usage card. */
export const formatVersionAge = (observedAt: string, now: number = Date.now()): string | null => {
  const elapsedMs = now - Date.parse(observedAt);
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return null;
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};
