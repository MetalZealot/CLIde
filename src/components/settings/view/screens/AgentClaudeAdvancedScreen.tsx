import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ClaudeSettingEntry, useClaudeSettings } from '../../hooks/useClaudeSettings';
import { agentScreenId, getScreen } from '../../registry/registry';
import type { SettingsProject } from '../../types/types';
import { advancedClaudeEntries, claudeEntryLabel } from '../../utils/claudeSettingsLayout';
import { SETTINGS_ICONS, SettingsGroup, SettingsNavRow, SettingsScreen, SettingsSearchField } from '../primitives';
import ClaudeGeneratedSettingRow from '../sections/agent/ClaudeGeneratedSettingRow';

type AgentClaudeAdvancedScreenProps = {
  projects: SettingsProject[];
  onOpenScreen: (screenId: string) => void;
};

/**
 * Agents › Claude › Advanced: the long tail, each with a control generated from
 * its SDK type and Anthropic's own description. A key newer than CLIde's
 * catalog arrives here, first, without anyone building it a row.
 */
export default function AgentClaudeAdvancedScreen({ projects, onOpenScreen }: AgentClaudeAdvancedScreenProps) {
  const { t } = useTranslation('settings');
  const { entries, error, save } = useClaudeSettings(projects);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matches = (entry: ClaudeSettingEntry) => !needle
    || claudeEntryLabel(entry).toLowerCase().includes(needle)
    || entry.key.toLowerCase().includes(needle)
    || (entry.description ?? '').toLowerCase().includes(needle);
  const rows = advancedClaudeEntries(entries).filter(matches);
  const fresh = rows.filter((entry) => entry.tier === 'unclassified');
  const rest = rows.filter((entry) => entry.tier !== 'unclassified');
  const sources = getScreen(agentScreenId('claude', 'configuration'));

  return (
    <SettingsScreen>
      <SettingsSearchField value={query} onChange={setQuery} />

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t(error === 'load' ? 'claudeSettings.loadError' : 'claudeSettings.saveError')}
        </p>
      )}

      {fresh.length > 0 && (
        <SettingsGroup divided title={t('claudeSettings.advanced.newTitle')} description={t('claudeSettings.advanced.newDescription')}>
          {fresh.map((entry) => <ClaudeGeneratedSettingRow key={entry.key} entry={entry} onSave={save} />)}
        </SettingsGroup>
      )}

      {rest.length > 0 && (
        <SettingsGroup divided description={needle ? undefined : t('claudeSettings.advanced.description')}>
          {rest.map((entry) => <ClaudeGeneratedSettingRow key={entry.key} entry={entry} onSave={save} />)}
        </SettingsGroup>
      )}

      {entries && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('claudeSettings.advanced.noMatches')}</p>
      )}

      {sources && (
        <SettingsGroup>
          <SettingsNavRow
            label={t(sources.labelKey)}
            icon={SETTINGS_ICONS[sources.icon]}
            onClick={() => onOpenScreen(sources.id)}
          />
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
