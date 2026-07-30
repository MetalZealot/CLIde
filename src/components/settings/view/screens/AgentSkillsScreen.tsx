import { ProviderSkills } from '../../../skills';
import type { SkillsProject } from '../../../skills/types';
import type { AgentProviderId } from '../../registry/registry';
import type { SettingsProject } from '../../types/types';
import { SettingsScreen } from '../primitives';

type AgentSkillsScreenProps = {
  provider: AgentProviderId;
  projects: SettingsProject[];
};

/**
 * Re-parenting, not a rewrite. The `overflow-y-auto` inside `ProviderSkills` is
 * in its add-skill Dialog, which is portalled out of the screen, so it does not
 * make a second scroller here.
 *
 * Only reachable for providers whose registry entry lists `skills`, which is
 * every provider but OpenCode.
 */
export default function AgentSkillsScreen({ provider, projects }: AgentSkillsScreenProps) {
  return (
    <SettingsScreen>
      <ProviderSkills
        selectedProvider={provider}
        currentProjects={projects.map<SkillsProject>((project) => ({
          projectId: project.name,
          displayName: project.displayName,
          fullPath: project.fullPath,
          path: project.path,
        }))}
      />
    </SettingsScreen>
  );
}
