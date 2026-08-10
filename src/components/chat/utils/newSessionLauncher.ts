import type { Project } from '../../../types/app';
import type { RepositoryEntry } from '../../sidebar/types/types';
import { getCheckoutRefLabel, isMainCheckout } from '../../sidebar/utils/utils';

export const resolvePrimaryCheckout = (entry: RepositoryEntry): Project =>
  entry.checkouts.find(isMainCheckout) ?? entry.leadCheckout;

export const getLauncherCheckoutLabel = (project: Project): string => {
  const refLabel = getCheckoutRefLabel(project);
  if (!project.repositoryId) {
    return 'Project root';
  }
  if (isMainCheckout(project)) {
    return refLabel && refLabel.toLowerCase() !== 'main' ? `Main — ${refLabel}` : 'Main';
  }
  return refLabel ?? project.displayName ?? project.projectId;
};
