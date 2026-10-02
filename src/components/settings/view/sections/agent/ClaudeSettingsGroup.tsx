import { useTranslation } from 'react-i18next';

import { useClaudeSettings } from '../../../hooks/useClaudeSettings';
import type { SettingsProject } from '../../../types/types';
import type { ClaudeSettingRowSpec } from '../../../utils/claudeSettingsLayout';
import { SettingsGroup } from '../../primitives';

import ClaudeSettingRow from './ClaudeSettingRow';

type ClaudeSettingsGroupProps = {
  rows: ClaudeSettingRowSpec[];
  title: string;
  description?: string;
  projects?: SettingsProject[];
};

const NO_PROJECTS: SettingsProject[] = [];

/** A few Claude Code settings placed on a screen that is not Claude's own category. */
export default function ClaudeSettingsGroup({ rows, title, description, projects = NO_PROJECTS }: ClaudeSettingsGroupProps) {
  const { t } = useTranslation('settings');
  const { entries, error, save } = useClaudeSettings(projects);

  return (
    <SettingsGroup divided title={title} description={description}>
      {rows.map((row) => (row.kind === 'screen' ? null : (
        <ClaudeSettingRow key={row.key} spec={row} entry={entries?.get(row.key)} projects={projects} onSave={save} />
      )))}
      {error && (
        <p className="px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          {t(error === 'load' ? 'claudeSettings.loadError' : 'claudeSettings.saveError')}
        </p>
      )}
    </SettingsGroup>
  );
}
