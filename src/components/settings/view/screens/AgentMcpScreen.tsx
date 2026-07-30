import { McpServers } from '../../../mcp';
import type { McpProject } from '../../../mcp/types';
import type { AgentProviderId } from '../../registry/registry';
import type { SettingsProject } from '../../types/types';
import { SettingsScreen } from '../primitives';

type AgentMcpScreenProps = {
  provider: AgentProviderId;
  projects: SettingsProject[];
};

/**
 * Re-parenting, not a rewrite: `McpServers` moves from a category pane inside the
 * old Agents grid to a screen of its own, unchanged. It opens no scroll container
 * of its own — its two modals are portalled Dialogs — so `SettingsScreen` is the
 * only scroller here.
 */
export default function AgentMcpScreen({ provider, projects }: AgentMcpScreenProps) {
  return (
    <SettingsScreen>
      <McpServers
        selectedProvider={provider}
        currentProjects={projects.map<McpProject>((project) => ({
          projectId: project.name,
          displayName: project.displayName,
          fullPath: project.fullPath,
          path: project.path,
        }))}
      />
    </SettingsScreen>
  );
}
