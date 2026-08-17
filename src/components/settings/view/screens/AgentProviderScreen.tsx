import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMcpServers } from '../../../mcp/hooks/useMcpServers';
import type { McpProject } from '../../../mcp/types';
import { useProviderSkills } from '../../../skills/hooks/useProviderSkills';
import { useCodexRuntimeStatus } from '../../hooks/useCodexRuntime';
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

function PermissionsSubsystemRow({ provider, onOpenScreen }: Omit<SubsystemRowProps, 'projects'>) {
  const { t } = useTranslation('settings');
  const screen = getScreen(agentScreenId(provider, 'permissions'));

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
 * Codex-only (ADR 0034). Previews the active runtime's version, and flags an
 * activation failure here so the drill-down is not the only place it surfaces.
 */
function RuntimeSubsystemRow({ provider, onOpenScreen }: Omit<SubsystemRowProps, 'projects'>) {
  const { t } = useTranslation('settings');
  const { status } = useCodexRuntimeStatus(provider === 'codex');
  const screen = getScreen(agentScreenId(provider, 'runtime'));

  if (!screen) {
    return null;
  }

  const active = status?.installations
    .find((installation) => installation.id === status.activeInstallationId);

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      value={active?.version}
      trailing={status?.activeError
        ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
        : undefined}
      onClick={() => onOpenScreen(screen.id)}
    />
  );
}

/**
 * No count or preview value here on purpose: reading it would mean fetching the
 * provider's whole model catalog to render one row, and the destination screen
 * fetches it anyway.
 */
function DefaultModelSubsystemRow({ provider, onOpenScreen }: Omit<SubsystemRowProps, 'projects'>) {
  const { t } = useTranslation('settings');
  const screen = getScreen(agentScreenId(provider, 'model'));

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
          {subsystems.includes('model') && (
            <DefaultModelSubsystemRow provider={provider} onOpenScreen={onOpenScreen} />
          )}
          {subsystems.includes('permissions') && (
            <PermissionsSubsystemRow provider={provider} onOpenScreen={onOpenScreen} />
          )}
          {subsystems.includes('mcp') && (
            <McpSubsystemRow provider={provider} projects={projects} onOpenScreen={onOpenScreen} />
          )}
          {subsystems.includes('skills') && (
            <SkillsSubsystemRow provider={provider} projects={projects} onOpenScreen={onOpenScreen} />
          )}
          {subsystems.includes('runtime') && (
            <RuntimeSubsystemRow provider={provider} onOpenScreen={onOpenScreen} />
          )}
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
