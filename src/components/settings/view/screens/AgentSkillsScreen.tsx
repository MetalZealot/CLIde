import { ProviderSkills } from '../../../skills';
import { GLOBAL_SKILLS_TARGET } from '../../../skills/types';
import type { AgentProviderId } from '../../registry/registry';
import { SettingsScreen } from '../primitives';

type AgentSkillsScreenProps = {
  provider: AgentProviderId;
};

/**
 * Re-parenting, not a rewrite. The `overflow-y-auto` inside `ProviderSkills` is
 * in its add-skill Dialog, which is portalled out of the screen, so it does not
 * make a second scroller here.
 *
 * Only reachable for providers whose registry entry lists `skills`, which is
 * every provider but OpenCode.
 */
export default function AgentSkillsScreen({ provider }: AgentSkillsScreenProps) {
  return (
    <SettingsScreen>
      <ProviderSkills
        selectedProvider={provider}
        target={GLOBAL_SKILLS_TARGET}
      />
    </SettingsScreen>
  );
}
