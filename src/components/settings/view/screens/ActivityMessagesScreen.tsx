import { useTranslation } from 'react-i18next';

import {
  DEFAULT_THINKING_MESSAGE_CYCLE_MODE,
  DEFAULT_THINKING_MESSAGE_ORDER,
  DEFAULT_THINKING_MESSAGES,
  THINKING_MESSAGE_TRANSLATION_KEYS,
  useThinkingMessages,
} from '../../../../hooks/useThinkingMessages';
import { SettingsScreen } from '../primitives';

import ThinkingMessagesEditor from './ThinkingMessagesEditor';

export default function ActivityMessagesScreen() {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');
  const {
    customMessages,
    cycleMode,
    messageOrder,
    setCustomMessages,
    setCycleMode,
    setMessageOrder,
    resetThinkingMessages,
  } = useThinkingMessages();
  const defaultThinkingMessages = THINKING_MESSAGE_TRANSLATION_KEYS.map((key, index) => (
    tChat(key, { defaultValue: DEFAULT_THINKING_MESSAGES[index] })
  ));

  return (
    <SettingsScreen description={t('chat.activityMessages.description')}>
      <ThinkingMessagesEditor
        messages={customMessages ?? defaultThinkingMessages}
        cycleMode={cycleMode}
        messageOrder={messageOrder}
        isCustom={
          customMessages !== null
          || cycleMode !== DEFAULT_THINKING_MESSAGE_CYCLE_MODE
          || messageOrder !== DEFAULT_THINKING_MESSAGE_ORDER
        }
        onChange={setCustomMessages}
        onCycleModeChange={setCycleMode}
        onMessageOrderChange={setMessageOrder}
        onReset={resetThinkingMessages}
      />
    </SettingsScreen>
  );
}
