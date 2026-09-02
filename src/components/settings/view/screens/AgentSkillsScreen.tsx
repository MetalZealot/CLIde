import { useEffect, useMemo, useState } from 'react';

import { ProviderSkills } from '../../../skills';
import { GLOBAL_SKILLS_TARGET, type SkillsTarget } from '../../../skills/types';
import type { AgentProviderId } from '../../registry/registry';
import type { SettingsProject } from '../../types/types';
import {
  SettingsChoicePopover,
  SettingsGroup,
  SettingsRow,
  SettingsScreen,
} from '../primitives';

type AgentSkillsScreenProps = {
  provider: AgentProviderId;
  projects: SettingsProject[];
};

type SkillsWorkspace = {
  projectId: string;
  displayName: string;
  path: string;
};

const GLOBAL_OPTION_VALUE = 'global';

/**
 * Saved projects are the only workspaces a skill can be listed for. Two saved
 * entries can point at one checkout, so paths are de-duplicated; sorting by
 * path keeps a main checkout next to its worktrees, whose display names are
 * often identical.
 */
const toSkillsWorkspaces = (projects: SettingsProject[]): SkillsWorkspace[] => {
  const seenPaths = new Set<string>();

  return projects
    .reduce<SkillsWorkspace[]>((workspaces, project) => {
      const projectPath = project.fullPath || project.path || '';
      if (!projectPath || seenPaths.has(projectPath)) {
        return workspaces;
      }

      seenPaths.add(projectPath);
      workspaces.push({
        projectId: project.name,
        displayName: project.displayName || project.name,
        path: projectPath,
      });
      return workspaces;
    }, [])
    .sort((left, right) => left.path.localeCompare(right.path));
};

/**
 * Skills for one provider, listed for one workspace at a time.
 *
 * Settings is opened from the sidebar and has no working directory of its own,
 * so there is no checkout to infer: the screen lists global skills until you
 * name a workspace, and the chosen path is what makes a project skill visible.
 * That is also why the choice resets — a remembered checkout would claim a
 * context this screen does not have.
 *
 * Only reachable for providers whose registry entry lists `skills`, which is
 * every provider but OpenCode.
 */
export default function AgentSkillsScreen({ provider, projects }: AgentSkillsScreenProps) {
  const [target, setTarget] = useState<SkillsTarget>(GLOBAL_SKILLS_TARGET);
  const workspaces = useMemo(() => toSkillsWorkspaces(projects), [projects]);

  useEffect(() => {
    setTarget(GLOBAL_SKILLS_TARGET);
  }, [provider]);

  const options = useMemo(() => [
    {
      value: GLOBAL_OPTION_VALUE,
      label: 'Global',
      detail: 'Available in every project',
    },
    ...workspaces.map((workspace) => ({
      value: workspace.path,
      label: workspace.displayName,
      detail: workspace.path,
      keywords: workspace.projectId,
    })),
  ], [workspaces]);

  const handleTargetChange = (value: string) => {
    const workspace = workspaces.find((candidate) => candidate.path === value);
    setTarget(workspace ? { kind: 'workspace', ...workspace } : GLOBAL_SKILLS_TARGET);
  };

  return (
    <SettingsScreen>
      <SettingsGroup>
        <SettingsRow
          label="Showing skills for"
          description="Global lists what every project can use. Pick a checkout to add its own skills."
          stacked
        >
          <SettingsChoicePopover
            value={target.kind === 'global' ? GLOBAL_OPTION_VALUE : target.path}
            options={options}
            onChange={handleTargetChange}
            ariaLabel="Showing skills for"
            className="w-full"
            searchable
            searchPlaceholder="Search projects"
            showSelectedDetail={false}
            stackedOptionDetails
          />
        </SettingsRow>
      </SettingsGroup>

      <ProviderSkills selectedProvider={provider} target={target} />
    </SettingsScreen>
  );
}
