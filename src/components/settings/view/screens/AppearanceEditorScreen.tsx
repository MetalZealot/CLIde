import { useTranslation } from 'react-i18next';

import type { CodeEditorSettingsState } from '../../types/types';
import {
  SettingsGroup,
  SettingsRow,
  SettingsScreen,
  SettingsSelect,
  SettingsToggle,
} from '../primitives';

type AppearanceEditorScreenProps = {
  codeEditorSettings: CodeEditorSettingsState;
  onWordWrapChange: (value: boolean) => void;
  onShowMinimapChange: (value: boolean) => void;
  onLineNumbersChange: (value: boolean) => void;
  onFontSizeChange: (value: string) => void;
};

const FONT_SIZES = ['10', '11', '12', '13', '14', '15', '16', '18', '20'];

/** Appearance › Code Editor — the reference depth-2 screen. */
export default function AppearanceEditorScreen({
  codeEditorSettings,
  onWordWrapChange,
  onShowMinimapChange,
  onLineNumbersChange,
  onFontSizeChange,
}: AppearanceEditorScreenProps) {
  const { t } = useTranslation('settings');

  return (
    <SettingsScreen>
      <SettingsGroup divided>
        <SettingsRow
          label={t('appearanceSettings.codeEditor.wordWrap.label')}
          description={t('appearanceSettings.codeEditor.wordWrap.description')}
        >
          <SettingsToggle
            checked={codeEditorSettings.wordWrap}
            onChange={onWordWrapChange}
            ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
          />
        </SettingsRow>

        <SettingsRow
          label={t('appearanceSettings.codeEditor.showMinimap.label')}
          description={t('appearanceSettings.codeEditor.showMinimap.description')}
        >
          <SettingsToggle
            checked={codeEditorSettings.showMinimap}
            onChange={onShowMinimapChange}
            ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
          />
        </SettingsRow>

        <SettingsRow
          label={t('appearanceSettings.codeEditor.lineNumbers.label')}
          description={t('appearanceSettings.codeEditor.lineNumbers.description')}
        >
          <SettingsToggle
            checked={codeEditorSettings.lineNumbers}
            onChange={onLineNumbersChange}
            ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
          />
        </SettingsRow>

        <SettingsRow
          label={t('appearanceSettings.codeEditor.fontSize.label')}
          description={t('appearanceSettings.codeEditor.fontSize.description')}
        >
          <SettingsSelect
            value={codeEditorSettings.fontSize}
            ariaLabel={t('appearanceSettings.codeEditor.fontSize.label')}
            onChange={onFontSizeChange}
            className="sm:w-28"
            options={FONT_SIZES.map((size) => ({ value: size, label: `${size}px` }))}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsScreen>
  );
}
