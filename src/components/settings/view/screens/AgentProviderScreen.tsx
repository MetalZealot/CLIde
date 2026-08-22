import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMcpServers } from '../../../mcp/hooks/useMcpServers';
import type { McpProject } from '../../../mcp/types';
import { useProviderSkills } from '../../../skills/hooks/useProviderSkills';
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentSubsystem,
  agentScreenId,
  getScreen,
} from '../../registry/registry';
import type { AuthStatus, NotificationPreferencesState, SettingsProject } from '../../types/types';
import { SETTINGS_ICONS, SettingsGroup, SettingsNavRow, SettingsScreen } from '../primitives';
import AgentAccountCard from '../sections/agent/AgentAccountCard';

type AgentProviderScreenProps = {
  provider: AgentProviderId;
  authStatus: AuthStatus;
  onLogin: () => void;
  loginSucceeded?: boolean | null;
  projects: SettingsProject[];
  onOpenScreen: (screenId: string) => void;
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  onOpenNotifications: () => void;
};

type SubsystemRowProps = {
  provider: AgentProviderId;
  projects: SettingsProject[];
  onOpenScreen: (screenId: string) => void;
};

/**
 * `SettingsProject.name` is populated from the DB projectId by
 * `normalizeProjectForSettings`, so it maps straight through to the identifier
 * the MCP and Skills subsystems expect. `McpProject` and `SkillsProject` are
 * structurally identical, so one mapping serves both.
 */
const toSubsystemProjects = (projects: SettingsProject[]): McpProject[] => (
  projects.map((project) => ({
    projectId: project.name,
    displayName: project.displayName,
    fullPath: project.fullPath,
    path: project.path,
  }))
);

const useSubsystemProjects = (projects: SettingsProject[]) => (
  useMemo(() => toSubsystemProjects(projects), [projects])
);

/**
 * The counts on these two rows come from the same hooks the destination screens
 * use, rather than a cheaper count endpoint, so the number can never disagree
 * with the list it previews. The hooks keep a module-level cache with a TTL, so
 * the fetch this triggers is also what makes drilling in instant.
 */
function McpSubsystemRow({ provider, projects, onOpenScreen }: SubsystemRowProps) {
  const { t } = useTranslation('settings');
  const currentProjects = useSubsystemProjects(projects);
  const { servers, isLoading } = useMcpServers({ selectedProvider: provider, currentProjects });
  const screen = getScreen(agentScreenId(provider, 'mcp'));

  if (!screen) {
    return null;
  }

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      value={isLoading && servers.length === 0
        ? undefined
        : t('agents.subsystems.mcpCount', { count: servers.length })}
      onClick={() => onOpenScreen(screen.id)}
    />
  );
}

function SkillsSubsystemRow({ provider, projects, onOpenScreen }: SubsystemRowProps) {
  const { t } = useTranslation('settings');
  const currentProjects = useSubsystemProjects(projects);
  const { skills, isLoading } = useProviderSkills({ selectedProvider: provider, currentProjects });
  const screen = getScreen(agentScreenId(provider, 'skills'));

  if (!screen) {
    return null;
  }

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      value={isLoading && skills.length === 0 ? undefined : String(skills.length)}
      onClick={() => onOpenScreen(screen.id)}
    />
  );
}

/**
 * Every subsystem whose row carries no preview value. Reading one would mean
 * fetching the whole model catalog, or the settings file, to render a single
 * row that the destination screen fetches anyway.
 */
function PlainSubsystemRow({
  provider,
  subsystem,
  onOpenScreen,
}: Omit<SubsystemRowProps, 'projects'> & { subsystem: AgentSubsystem }) {
  const { t } = useTranslation('settings');
  const screen = getScreen(agentScreenId(provider, subsystem));

  if (!screen) {
    return null;
  }

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      onClick={() => onOpenScreen(screen.id)}
    />
  );
}

/**
 * A provider's own screen: the account card, then one nav row per subsystem it
 * supports. This is what replaces the provider × category grid — the two tab
 * rows that used to sit above a nested scroller are now the root list and these
 * rows, so the screen owns exactly one scroll container.
 *
 * Which rows appear is driven by `AGENT_PROVIDERS`, not by branching here, so
 * OpenCode's missing Permissions and Skills stay a registry fact.
 */
export default function AgentProviderScreen({
  provider,
  authStatus,
  onLogin,
  loginSucceeded = null,
  projects,
  onOpenScreen,
  notificationPreferences,
  onNotificationPreferencesChange,
  onOpenNotifications,
}: AgentProviderScreenProps) {
  const subsystems: AgentSubsystem[] = AGENT_PROVIDERS
    .find((descriptor) => descriptor.id === provider)?.subsystems ?? [];

  return (
    <SettingsScreen>
      <AgentAccountCard
        provider={provider}
        authStatus={authStatus}
        onLogin={onLogin}
        loginSucceeded={loginSucceeded}
        notificationPreferences={notificationPreferences}
        onNotificationPreferencesChange={onNotificationPreferencesChange}
        onOpenNotifications={onOpenNotifications}
      />

      {subsystems.length > 0 && (
        <SettingsGroup divided>
          {/* Rendered from the registry list, in its order, so registering a
              subsystem is the whole job — an unlisted one has no way in. Only
              the two rows that preview a count need a component of their own. */}
          {subsystems.map((subsystem) => {
            if (subsystem === 'mcp') {
              return (
                <McpSubsystemRow
                  key={subsystem}
                  provider={provider}
                  projects={projects}
                  onOpenScreen={onOpenScreen}
                />
              );
            }
            if (subsystem === 'skills') {
              return (
                <SkillsSubsystemRow
                  key={subsystem}
                  provider={provider}
                  projects={projects}
                  onOpenScreen={onOpenScreen}
                />
              );
            }
            return (
              <PlainSubsystemRow
                key={subsystem}
                provider={provider}
                subsystem={subsystem}
                onOpenScreen={onOpenScreen}
              />
            );
          })}
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
