import type { Project } from '../../../types/app';

import { isDiscoveredCheckout } from './utils';

/** Exact active-session total supplied by the server, with a loaded-list fallback. */
export const getWorktreeSessionCount = (project: Project): number => {
  const serverTotal = project.sessionMeta?.total;
  return typeof serverTotal === 'number' && Number.isFinite(serverTotal)
    ? Math.max(0, serverTotal)
    : (project.sessions?.length ?? 0);
};

/** Discovered checkouts have no stored project row and cannot be batch targets. */
export const getBatchSelectableWorktrees = (checkouts: Project[]): Project[] =>
  checkouts.filter((checkout) => !isDiscoveredCheckout(checkout));

/** Keeps the useful path suffix visible without baking in the host username. */
export const compactHomePath = (fullPath: string): string =>
  fullPath.replace(/^\/home\/[^/]+(?=\/|$)/, '~');

const trimTrailingSlash = (path: string): string => path.replace(/\/+$/, '');
const lastSegment = (path: string): string => trimTrailingSlash(path).split('/').pop() ?? '';
const parentDirectory = (path: string): string => trimTrailingSlash(path).replace(/\/[^/]*$/, '');

/**
 * The path earns its own line only when the row's name does not already give it
 * away: a renamed checkout, or a tree that does not sit beside the repository.
 */
export const shouldShowWorktreePath = (project: Project, leadCheckoutPath: string): boolean => {
  const name = project.displayName || project.projectId;
  return (
    lastSegment(project.fullPath) !== name
    || parentDirectory(project.fullPath) !== parentDirectory(leadCheckoutPath)
  );
};

export type WorktreeChangeSummary = {
  path: string;
  changedFiles: number;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
};

export type WorktreeStatusPhase = 'loading' | 'ready';

export type WorktreeStatusView =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'counts'; changedFiles: number; ahead: number; behind: number };

/** Absolute paths compare equal whichever side added a trailing slash. */
export const worktreeStatusKey = (fullPath: string): string => fullPath.replace(/\/+$/, '');

/**
 * What a row's status line should say.
 *
 * A clean tree is `hidden`, not "no changes": a grey line under every clean row
 * is a line the eye learns to skip, and the panel's whole point is that a third
 * line means something is there. Silence therefore has to mean clean and
 * nothing else, which is why a missing summary reports `unavailable` rather
 * than falling back to clean.
 */
export const describeWorktreeStatus = (
  summary: WorktreeChangeSummary | undefined,
  phase: WorktreeStatusPhase,
): WorktreeStatusView => {
  if (phase === 'loading') {
    return { kind: 'loading' };
  }
  if (!summary) {
    return { kind: 'unavailable' };
  }
  if (!summary.changedFiles && !summary.ahead && !summary.behind) {
    return { kind: 'hidden' };
  }
  return {
    kind: 'counts',
    changedFiles: summary.changedFiles,
    ahead: summary.ahead,
    behind: summary.behind,
  };
};
