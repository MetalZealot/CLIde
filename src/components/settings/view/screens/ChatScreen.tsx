import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { DEFAULT_THINKING_MESSAGES, useThinkingMessages } from '../../../../hooks/useThinkingMessages';
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
 * that panel once this exists) plus the voice enable toggles. Read aloud and
 * dictation gate separately; the voice settings screen below is shared, so one
 * of them being on is enough to reach it.
 */
export default function ChatScreen({ onOpenScreen }: ChatScreenProps) {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { customMessages, cycleMode } = useThinkingMessages();
  const isTouchPrimary = isTouchPrimaryDevice();
  const activityMessagesScreen = getScreen('chat.activityMessages');
  const voiceBackendScreen = getScreen('chat.voice');
  // Blank and empty custom lists fall back to the built-ins in the indicator; count what it shows.
  const activityMessageCount = customMessages?.filter((message) => message.trim()).length
    || DEFAULT_THINKING_MESSAGES.length;
  const activityMessageSummary = cycleMode === 'never'
    ? t('chat.activityMessages.summaryNever', { count: activityMessageCount })
    : cycleMode === 'turn'
      ? t('chat.activityMessages.summaryTurn', { count: activityMessageCount })
      : t('chat.activityMessages.summarySeconds', {
        count: activityMessageCount,
        seconds: Number(cycleMode),
      });

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

      {activityMessagesScreen && (
        <SettingsGroup>
          <SettingsNavRow
            label={t(activityMessagesScreen.labelKey)}
            description={activityMessageSummary}
            wrapDescription
            icon={SETTINGS_ICONS[activityMessagesScreen.icon]}
            onClick={() => onOpenScreen(activityMessagesScreen.id)}
          />
        </SettingsGroup>
      )}

      <SettingsGroup title={t('voiceSettings.title')} divided>
        <SettingsRow
          label={t('voiceSettings.enableTts')}
          description={t('voiceSettings.enableTtsDescription')}
        >
          <SettingsToggle
            checked={preferences.ttsEnabled}
            onChange={(value) => setPreference('ttsEnabled', value)}
            ariaLabel={t('voiceSettings.enableTts')}
          />
        </SettingsRow>
        <SettingsRow
          label={t('voiceSettings.enableStt')}
          description={t('voiceSettings.enableSttDescription')}
        >
          <SettingsToggle
            checked={preferences.sttEnabled}
            onChange={(value) => setPreference('sttEnabled', value)}
            ariaLabel={t('voiceSettings.enableStt')}
          />
        </SettingsRow>
      </SettingsGroup>

      {(preferences.ttsEnabled || preferences.sttEnabled) && voiceBackendScreen && (
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
