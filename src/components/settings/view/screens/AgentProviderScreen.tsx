import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProviderCapabilities } from '../../../../hooks/useProviderCapabilities';
import { Button } from '../../../../shared/view/ui';
import type { ProviderModelsDefinition } from '../../../../types/app';
import { authenticatedFetch } from '../../../../utils/api';
import { readProviderDefaultModel } from '../../../../utils/providerDefaultModel';
import { useProviderUsage } from '../../../provider-usage/hooks/useProviderUsage';
import { supportsProviderUsageReset } from '../../../provider-usage/types';
import { useProviderSkills } from '../../../skills/hooks/useProviderSkills';
import { GLOBAL_SKILLS_TARGET } from '../../../skills/types';
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentSubsystem,
  agentScreenId,
  getScreen,
} from '../../registry/registry';
import type {
  AuthStatus,
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  NotificationPreferencesState,
  SettingsProject,
} from '../../types/types';
import { cascadeUrl, initialConfigurationProject } from '../../utils/claudeConfiguration';
import { SETTINGS_ICONS, SettingsGroup, SettingsNavRow, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';
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
  onOpenUsage: () => void;
  /** Read for the Permissions row's preview; absent renders the row without one. */
  permissions?: {
    claude: ClaudePermissionsState;
    cursor: CursorPermissionsState;
    codex: CodexPermissionMode;
  };
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

/** Reads one value through an authenticated GET; null until it lands or if it fails. */
function useFetchedValue<T>(url: string | null, pick: (data: unknown) => T | null): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    authenticatedFetch(url)
      .then((response) => response.json())
      .then((body) => { if (!cancelled && body.success) setValue(pick(body.data)); })
      .catch(() => {});
    return () => { cancelled = true; };
    // `pick` is a pure reader; the URL alone decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return value;
}

/** The model a new chat starts on: the stored choice, else the catalog's own default. */
function useDefaultModelLabel(provider: AgentProviderId): string | null {
  const catalog = useFetchedValue(
    `/api/providers/${provider}/models`,
    (data) => (data as { models?: ProviderModelsDefinition }).models ?? null,
  );
  if (!catalog) return null;
  const stored = readProviderDefaultModel(provider);
  const option = catalog.OPTIONS.find((candidate) => candidate.value === stored)
    ?? catalog.OPTIONS.find((candidate) => candidate.isDefault);
  return option?.label ?? null;
}

function usePermissionsSummary(
  provider: AgentProviderId,
  permissions: AgentProviderScreenProps['permissions'],
): string | null {
  const { t } = useTranslation('settings');
  if (!permissions) return null;
  if (provider === 'codex') {
    return t(`permissions.codex.modes.${permissions.codex}.title`);
  }
  const state = provider === 'claude' ? permissions.claude : provider === 'cursor' ? permissions.cursor : null;
  if (!state) return null;
  if ('skipPermissions' in state && state.skipPermissions) return t('agents.subsystems.promptsSkipped');
  const allowed = 'allowedTools' in state ? state.allowedTools.length : state.allowedCommands.length;
  return allowed > 0
    ? t('agents.subsystems.allowedCount', { count: allowed })
    : t('agents.subsystems.asksFirst');
}

/**
 * Every subsystem row but Tools. Each previews its current value, so the list
 * answers "what is it set to" without drilling in.
 */
function ValuedSubsystemRow({
  provider,
  subsystem,
  value,
  onOpenScreen,
}: Omit<SubsystemRowProps, 'projects'> & { subsystem: AgentSubsystem; value: string | null }) {
  const { t } = useTranslation('settings');
  const screen = getScreen(agentScreenId(provider, subsystem));

  if (!screen) {
    return null;
  }

  return (
    <SettingsNavRow
      label={t(screen.labelKey)}
      icon={SETTINGS_ICONS[screen.icon]}
      value={value ?? undefined}
      onClick={() => onOpenScreen(screen.id)}
    />
  );
}

/**
 * A provider's own screen: the account card, then one nav row per subsystem it
 * supports, ending with the provider's usage reset alert. This is what replaces the provider × category grid — the two tab
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
  onOpenUsage,
  permissions,
}: AgentProviderScreenProps) {
  const { t } = useTranslation(['settings', 'common']);
  const subsystems: AgentSubsystem[] = AGENT_PROVIDERS
    .find((descriptor) => descriptor.id === provider)?.subsystems ?? [];
  const planUsage = useProviderUsage(provider, {
    enabled: authStatus.authenticated && !authStatus.loading,
  });
  const capabilities = useProviderCapabilities();
  const supportsUsageReset = authStatus.authenticated && supportsProviderUsageReset(
    capabilities?.[provider]?.supportsUsageResetAlerts === true,
    authStatus.method,
    planUsage.usage?.supported === true,
  );
  const hasNotificationChannel = notificationPreferences.channels.webPush
    || notificationPreferences.channels.desktop;
  const usageResetEnabled = notificationPreferences.events.usageReset[provider] === true;
  const resetAlertLabel = t('agents.usage.resetAlert');

  const values: Partial<Record<AgentSubsystem, string | null>> = {
    model: useDefaultModelLabel(provider),
    // The level the default model runs at, as the composer shows it.
    effort: useFetchedValue(
      subsystems.includes('effort') ? '/api/providers/claude/effort-defaults' : null,
      (data) => {
        const rows = (data as { models?: { isDefault?: boolean; effort?: string | null }[] }).models ?? [];
        return (rows.find((row) => row.isDefault) ?? rows[0])?.effort ?? null;
      },
    ),
    autoCompact: useFetchedValue(
      subsystems.includes('autoCompact') ? '/api/providers/claude/auto-compact' : null,
      (data) => ((data as { enabled?: boolean }).enabled ? t('agents.subsystems.on') : t('agents.subsystems.off')),
    ),
    permissions: usePermissionsSummary(provider, permissions),
    // Counted against the project the Configuration screen will open on.
    configuration: useFetchedValue(
      subsystems.includes('configuration') ? cascadeUrl(initialConfigurationProject(projects)) : null,
      (data) => t('agents.subsystems.settingsCount', {
        count: ((data as { entries?: unknown[] }).entries ?? []).length,
      }),
    ),
  };

  const setUsageResetEnabled = (enabled: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      events: {
        ...notificationPreferences.events,
        usageReset: {
          ...notificationPreferences.events.usageReset,
          [provider]: enabled,
        },
      },
    });
  };

  return (
    <SettingsScreen>
      <AgentAccountCard
        provider={provider}
        authStatus={authStatus}
        onLogin={onLogin}
        loginSucceeded={loginSucceeded}
        planUsage={planUsage.usage}
        onOpenUsage={onOpenUsage}
      />

      {(subsystems.length > 0 || supportsUsageReset) && (
        <SettingsGroup divided>
          {/* Rendered from the registry list, in its order, so registering a
              subsystem is the whole job — an unlisted one has no way in. Only
              the Tools row, whose count comes from the skills hook, needs a
              component of its own. */}
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
              <ValuedSubsystemRow
                key={subsystem}
                provider={provider}
                subsystem={subsystem}
                value={values[subsystem] ?? null}
                onOpenScreen={onOpenScreen}
              />
            );
          })}

          {supportsUsageReset && (
            <SettingsRow
              className="py-3"
              icon={<Bell className="h-4 w-4 text-muted-foreground" />}
              label={resetAlertLabel}
              description={hasNotificationChannel ? undefined : t('agents.usage.resetAlertChannelRequired')}
            >
              <SettingsToggle
                checked={usageResetEnabled}
                onChange={setUsageResetEnabled}
                ariaLabel={resetAlertLabel}
              />
            </SettingsRow>
          )}
          {supportsUsageReset && !hasNotificationChannel && (
            <div className="px-4 py-3">
              <Button type="button" variant="outline" size="sm" onClick={onOpenNotifications}>
                {t('common:usageDashboard.notifications.openSettings', { defaultValue: 'Notification settings' })}
              </Button>
            </div>
          )}
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
