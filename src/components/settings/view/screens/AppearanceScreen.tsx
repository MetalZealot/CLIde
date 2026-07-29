import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../../contexts/ThemeContext';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import { getScreen } from '../../registry/registry';
import type { ProjectSortOrder } from '../../types/types';
import {
  SETTINGS_ICONS,
  SettingsGroup,
  SettingsNavRow,
  SettingsRow,
  SettingsScreen,
  SettingsSegmentedControl,
  SettingsSelect,
} from '../primitives';

type ThemePreference = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
};

type AppearanceScreenProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  onOpenScreen: (screenId: string) => void;
};

/**
 * The reference port. Every other screen should read like this one: a
 * `SettingsScreen` wrapper, `SettingsGroup` sections, rows built from the
 * shared primitives, no bespoke divs and no colour classes.
 *
 * Project sorting still lives here rather than in Projects & Git, where the IA
 * spec puts it; P3b moves it when that screen is created, so that it is never
 * unreachable in between.
 */
export default function AppearanceScreen({
  projectSortOrder,
  onProjectSortOrderChange,
  onOpenScreen,
}: AppearanceScreenProps) {
  const { t } = useTranslation('settings');
  const { theme, setTheme } = useTheme() as ThemeContextValue;

  const editorScreen = getScreen('appearance.editor');

  return (
    <SettingsScreen>
      <SettingsGroup>
        <SettingsRow
          stacked
          label={t('appearanceSettings.theme.title')}
          description={t('appearanceSettings.theme.description')}
        >
          <SettingsSegmentedControl<ThemePreference>
            value={theme}
            className="w-full justify-between"
            ariaLabel={t('appearanceSettings.theme.title')}
            onChange={setTheme}
            options={[
              { value: 'light', label: t('appearanceSettings.theme.light') },
              { value: 'dark', label: t('appearanceSettings.theme.dark') },
              { value: 'system', label: t('appearanceSettings.theme.system') },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('appearanceSettings.language.title')}>
        <LanguageSelector />
      </SettingsGroup>

      <SettingsGroup title={t('appearanceSettings.projectSorting.label')}>
        <SettingsRow
          label={t('appearanceSettings.projectSorting.label')}
          description={t('appearanceSettings.projectSorting.description')}
        >
          <SettingsSelect<ProjectSortOrder>
            value={projectSortOrder}
            ariaLabel={t('appearanceSettings.projectSorting.label')}
            onChange={onProjectSortOrderChange}
            className="sm:w-36"
            options={[
              { value: 'name', label: t('appearanceSettings.projectSorting.alphabetical') },
              { value: 'date', label: t('appearanceSettings.projectSorting.recentActivity') },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      {editorScreen && (
        <SettingsGroup>
          <SettingsNavRow
            label={t(editorScreen.labelKey)}
            description={t('appearanceSettings.codeEditor.description')}
            icon={SETTINGS_ICONS[editorScreen.icon]}
            onClick={() => onOpenScreen(editorScreen.id)}
          />
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
