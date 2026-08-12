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
