import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../../contexts/ThemeContext';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import { getScreen } from '../../registry/registry';
import {
  SETTINGS_ICONS,
  SettingsGroup,
  SettingsNavRow,
  SettingsRow,
  SettingsScreen,
  SettingsSegmentedControl,
} from '../primitives';

type ThemePreference = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
};

type AppearanceScreenProps = {
  onOpenScreen: (screenId: string) => void;
};

/**
 * The reference port. Every other screen should read like this one: a
 * `SettingsScreen` wrapper, `SettingsGroup` sections, rows built from the
 * shared primitives, no bespoke divs and no colour classes.
 *
 * Project sorting moved to Projects & Git in P3b, per the IA spec.
 */
export default function AppearanceScreen({
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
