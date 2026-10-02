import { useTranslation } from 'react-i18next';

import {
  useClaudeAutoCompactLabel,
  useClaudeDefaultEffort,
  useDefaultModelLabel,
} from '../../hooks/useAgentSubsystemValues';
import { useClaudeSettings } from '../../hooks/useClaudeSettings';
import { type AgentSubsystem, agentScreenId, getScreen } from '../../registry/registry';
import type { SettingsProject } from '../../types/types';
import { CLAUDE_SETTINGS_LAYOUT, type ClaudeSettingsCategory } from '../../utils/claudeSettingsLayout';
import { SETTINGS_ICONS, SettingsGroup, SettingsNavRow, SettingsScreen } from '../primitives';
import ClaudeSettingRow from '../sections/agent/ClaudeSettingRow';

type AgentClaudeCategoryScreenProps = {
  category: ClaudeSettingsCategory;
  projects: SettingsProject[];
  onOpenScreen: (screenId: string) => void;
};

/**
 * One category of Claude Code settings (Agents › Claude › Model & thinking, …),
 * drawn from `CLAUDE_SETTINGS_LAYOUT`. Existing screens such as Default Model
 * appear as rows that open them.
 */
export default function AgentClaudeCategoryScreen({ category, projects, onOpenScreen }: AgentClaudeCategoryScreenProps) {
  const { t } = useTranslation('settings');
  const { entries, error, save } = useClaudeSettings(projects);
  const sections = CLAUDE_SETTINGS_LAYOUT[category];
  const hasScreenRows = category === 'modelThinking';
  const screenValues: Partial<Record<AgentSubsystem, string | null>> = {
    model: useDefaultModelLabel('claude', hasScreenRows),
    effort: useClaudeDefaultEffort(hasScreenRows),
    autoCompact: useClaudeAutoCompactLabel(hasScreenRows),
  };

  return (
    <SettingsScreen>
      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t(error === 'load' ? 'claudeSettings.loadError' : 'claudeSettings.saveError')}
        </p>
      )}
      {sections.map((section, index) => (
        <SettingsGroup
          // Sections are static per category, so their order is a stable key.
          key={index}
          divided
          title={section.titleKey ? t(section.titleKey) : undefined}
        >
          {section.rows.map((row) => {
            if (row.kind === 'screen') {
              const screen = getScreen(agentScreenId('claude', row.screen));
              if (!screen) return null;
              return (
                <SettingsNavRow
                  key={screen.id}
                  label={t(screen.labelKey)}
                  icon={SETTINGS_ICONS[screen.icon]}
                  value={screenValues[row.screen] ?? undefined}
                  onClick={() => onOpenScreen(screen.id)}
                />
              );
            }
            return (
              <ClaudeSettingRow
                key={row.key}
                spec={row}
                entry={entries?.get(row.key)}
                projects={projects}
                onSave={save}
              />
            );
          })}
        </SettingsGroup>
      ))}
    </SettingsScreen>
  );
}
