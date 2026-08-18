import type { Project } from '../../../types/app';
import type { RepositoryEntry } from '../../sidebar/types/types';
import { isDiscoveredCheckout, isMainCheckout } from '../../sidebar/utils/utils';

export const resolvePrimaryCheckout = (entry: RepositoryEntry): Project =>
  entry.checkouts.find(isMainCheckout) ?? entry.leadCheckout;

/** Registers a discovered checkout before chat receives it as a target. */
export const resolveLauncherCheckoutSelection = async (
  checkout: Project,
  adoptCheckout: (checkoutPath: string) => Promise<Project | null>,
): Promise<Project | null> => (
  isDiscoveredCheckout(checkout) ? adoptCheckout(checkout.fullPath) : checkout
);
