import type { Project } from '../../../types/app';
import type { RepositoryEntry } from '../../sidebar/types/types';
import { buildRepositoryEntries, isDiscoveredCheckout, isMainCheckout, repositoryEntryKey } from '../../sidebar/utils/utils';

export const resolvePrimaryCheckout = (entry: RepositoryEntry): Project =>
  entry.checkouts.find(isMainCheckout) ?? entry.leadCheckout;

/** Registers a discovered checkout before chat receives it as a target. */
export const resolveLauncherCheckoutSelection = async (
  checkout: Project,
  adoptCheckout: (checkoutPath: string) => Promise<Project | null>,
): Promise<Project | null> => (
  isDiscoveredCheckout(checkout) ? adoptCheckout(checkout.fullPath) : checkout
);

export const NEW_SESSION_PROJECT_MODES = ['last', 'fixed', 'none'] as const;
export type NewSessionProjectMode = (typeof NEW_SESSION_PROJECT_MODES)[number];

/** A remembered checkout, plus its repository so a deleted worktree falls back to the main checkout. */
export type NewSessionProjectTarget = { projectId: string; repositoryKey: string };

export type NewSessionProjectPreference = {
  mode: NewSessionProjectMode;
  fixed: NewSessionProjectTarget | null;
  last: NewSessionProjectTarget | null;
};

const STORAGE_KEY = 'newSessionProject';
const DEFAULT_PREFERENCE: NewSessionProjectPreference = { mode: 'last', fixed: null, last: null };

const parseTarget = (value: unknown): NewSessionProjectTarget | null => {
  if (!value || typeof value !== 'object') return null;
  const { projectId, repositoryKey } = value as Record<string, unknown>;
  return typeof projectId === 'string' && projectId && typeof repositoryKey === 'string' && repositoryKey
    ? { projectId, repositoryKey }
    : null;
};

export const toNewSessionProjectTarget = (project: Project): NewSessionProjectTarget => ({
  projectId: project.projectId,
  repositoryKey: repositoryEntryKey(project),
});

/** Per device, like the other UI preferences. */
export const readNewSessionProjectPreference = (): NewSessionProjectPreference => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFERENCE;
    const mode = NEW_SESSION_PROJECT_MODES.includes(parsed.mode as NewSessionProjectMode)
      ? (parsed.mode as NewSessionProjectMode)
      : DEFAULT_PREFERENCE.mode;
    return { mode, fixed: parseTarget(parsed.fixed), last: parseTarget(parsed.last) };
  } catch {
    return DEFAULT_PREFERENCE;
  }
};

export const writeNewSessionProjectPreference = (changes: Partial<NewSessionProjectPreference>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readNewSessionProjectPreference(), ...changes }));
  } catch {
    // Storage unavailable: the launcher simply starts blank.
  }
};

/** The exact checkout if it still exists, else its repository's main checkout, else null. */
export const findNewSessionProjectTarget = (
  projects: Project[],
  target: NewSessionProjectTarget | null,
): Project | null => {
  if (!target) return null;
  const registered = projects.filter((project) => !isDiscoveredCheckout(project));
  const exact = registered.find((project) => project.projectId === target.projectId);
  if (exact) return exact;
  const entry = buildRepositoryEntries(registered).find((candidate) => candidate.key === target.repositoryKey);
  return entry ? resolvePrimaryCheckout(entry) : null;
};

export const resolveNewSessionProject = (
  projects: Project[],
  preference: NewSessionProjectPreference,
): Project | null => {
  if (preference.mode === 'none') return null;
  return findNewSessionProjectTarget(projects, preference.mode === 'fixed' ? preference.fixed : preference.last);
};
