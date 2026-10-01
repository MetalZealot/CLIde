import type { SettingsProject } from '../types/types';

/** Empty string selects no project: user and managed files only. */
export const NO_PROJECT = '';
const LAST_PROJECT_KEY = 'claude-configuration-project';

export const projectPathOf = (project: SettingsProject): string => project.fullPath || project.path || '';

/** The remembered project if it still exists, else the first one listed. */
export const initialConfigurationProject = (projects: SettingsProject[]): string => {
  const paths = projects.map(projectPathOf).filter(Boolean);
  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  if (remembered !== null && (remembered === NO_PROJECT || paths.includes(remembered))) return remembered;
  return paths[0] ?? NO_PROJECT;
};

export const cascadeUrl = (workspacePath: string): string => (
  workspacePath
    ? `/api/providers/claude/settings-cascade?workspacePath=${encodeURIComponent(workspacePath)}`
    : '/api/providers/claude/settings-cascade'
);

export const rememberConfigurationProject = (workspacePath: string): void => {
  localStorage.setItem(LAST_PROJECT_KEY, workspacePath);
};
