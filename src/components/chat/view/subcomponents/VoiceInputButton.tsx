import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2 } from 'lucide-react';

import { PromptInputButton } from '../../../../shared/view/ui';
import type { VoiceInputState } from '../../hooks/useVoiceInput';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
};

// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({ state, onToggle }: Props) {
  const { t } = useTranslation('chat');

  const icon =
    state === 'recording' ? (
      <Square className="text-red-500" />
    ) : state === 'starting' || state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : (
      <Mic />
    );

  const tooltip = state === 'recording'
    ? t('voice.stopRecording')
    : state === 'starting'
      ? t('voice.loading')
      : state === 'transcribing'
        ? t('voice.transcribing')
        : t('voice.input');

  return (
    <span className="inline-flex">
      <PromptInputButton
        tooltip={{ content: tooltip }}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
      >
        {icon}
      </PromptInputButton>
    </span>
  );
}
