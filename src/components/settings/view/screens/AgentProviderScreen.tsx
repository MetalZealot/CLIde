import { useTranslation } from 'react-i18next';

import { useProviderSkills } from '../../../skills/hooks/useProviderSkills';
import { GLOBAL_SKILLS_TARGET } from '../../../skills/types';
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
 * The count comes from the same hook the Tools page uses, so the number can
 * never disagree with the list it previews, and the fetch it triggers is what
 * makes drilling in instant.
 */
function ToolsSubsystemRow({ provider, onOpenScreen }: SubsystemRowProps) {
  const { t } = useTranslation('settings');
  const { skills, isLoading } = useProviderSkills({
    selectedProvider: provider,
    target: GLOBAL_SKILLS_TARGET,
  });
  const screen = getScreen(agentScreenId(provider, 'tools'));
  const listsSkills = AGENT_PROVIDERS.find((descriptor) => descriptor.id === provider)?.listsSkills;

  if (!screen) {
    return null;
  }

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      value={!listsSkills || (isLoading && skills.length === 0)
        ? undefined
        : t('agents.subsystems.toolsCount', { count: skills.length })}
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
 * OpenCode's missing Permissions stays a registry fact.
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
              the Tools row, which previews a count, needs a component of its own. */}
          {subsystems.map((subsystem) => {
            if (subsystem === 'tools') {
              return (
                <ToolsSubsystemRow
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
