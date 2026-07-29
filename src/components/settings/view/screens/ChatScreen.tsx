import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { isTouchPrimaryDevice } from '../../../../utils/pointer';
import { getScreen } from '../../registry/registry';
import {
  SETTINGS_ICONS,
  SettingsGroup,
  SettingsNavRow,
  SettingsRow,
  SettingsScreen,
  SettingsToggle,
} from '../primitives';

type ChatScreenProps = {
  onOpenScreen: (screenId: string) => void;
};

/**
 * Absorbs the QuickSettings panel's tool-display and input prefs (P5 deletes
 * that panel once this exists) plus the old top-level Voice tab's enable
 * toggle. `useUiPreferences` is untouched — this only moves which UI reads and
 * writes it, same as every other QuickSettings-owned instance of the hook.
 */
export default function ChatScreen({ onOpenScreen }: ChatScreenProps) {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const isTouchPrimary = isTouchPrimaryDevice();
  const voiceBackendScreen = getScreen('chat.voice');

  return (
    <SettingsScreen>
      <SettingsGroup title={t('chat.messageDisplay.title')} divided>
        <SettingsRow label={t('quickSettings.showRawParameters')}>
          <SettingsToggle
            checked={preferences.showRawParameters}
            onChange={(value) => setPreference('showRawParameters', value)}
            ariaLabel={t('quickSettings.showRawParameters')}
          />
        </SettingsRow>
        <SettingsRow label={t('quickSettings.showThinking')}>
          <SettingsToggle
            checked={preferences.showThinking}
            onChange={(value) => setPreference('showThinking', value)}
            ariaLabel={t('quickSettings.showThinking')}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('chat.input.title')}>
        {isTouchPrimary ? (
          <SettingsRow
            label={t('quickSettings.enterToSend')}
            description={t('quickSettings.enterToSendDescription')}
          >
            <SettingsToggle
              checked={preferences.enterToSend}
              onChange={(value) => setPreference('enterToSend', value)}
              ariaLabel={t('quickSettings.enterToSend')}
            />
          </SettingsRow>
        ) : (
          <SettingsRow
            label={t('quickSettings.sendByCtrlEnter')}
            description={t('quickSettings.sendByCtrlEnterDescription')}
          >
            <SettingsToggle
              checked={preferences.sendByCtrlEnter}
              onChange={(value) => setPreference('sendByCtrlEnter', value)}
              ariaLabel={t('quickSettings.sendByCtrlEnter')}
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('voiceSettings.title')}>
        <SettingsRow
          label={t('voiceSettings.enable')}
          description={t('voiceSettings.enableDescription')}
        >
          <SettingsToggle
            checked={preferences.voiceEnabled}
            onChange={(value) => setPreference('voiceEnabled', value)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </SettingsRow>
      </SettingsGroup>

      {preferences.voiceEnabled && voiceBackendScreen && (
        <SettingsGroup>
          <SettingsNavRow
            label={t(voiceBackendScreen.labelKey)}
            description={t('voiceSettings.backendDescription')}
            icon={SETTINGS_ICONS[voiceBackendScreen.icon]}
            onClick={() => onOpenScreen(voiceBackendScreen.id)}
          />
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
