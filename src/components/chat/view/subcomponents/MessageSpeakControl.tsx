import { Volume2, Loader2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatPlaybackTime } from '../../../../lib/voicePlayer';
import { useTts } from '../../hooks/useTts';
import { useTtsAvailable } from '../../hooks/useVoiceAvailable';

// Tap-to-speak button beside the copy control on assistant messages.
// Renders nothing unless the optional voice feature is enabled.
const MessageSpeakControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const available = useTtsAvailable();
  const {
    state,
    toggle,
    restart,
    error,
    currentTime,
    duration,
    generationElapsedSeconds,
  } = useTts(() => content);

  if (!available) return null;

  const title = state === 'playing'
    ? t('voice.pauseSpeaking')
    : state === 'paused'
      ? t('voice.resumeSpeaking')
      : state === 'loading'
        ? t('voice.cancelGeneration')
        : t('voice.speak');
  const isActive = state === 'playing' || state === 'paused';

  return (
    <span className="relative inline-flex items-center gap-0.5">
      {error && (
        <span className="absolute bottom-full left-0 z-10 mb-1 max-w-[min(240px,calc(100vw-2rem))] break-words rounded bg-red-600 px-2 py-1 text-left text-xs text-white shadow-lg">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        {state === 'playing' ? (
          <Pause className="h-3.5 w-3.5" />
        ) : state === 'paused' ? (
          <Play className="h-3.5 w-3.5" />
        ) : state === 'loading' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[10px] tabular-nums">
              {t('voice.generating', { seconds: generationElapsedSeconds })}
            </span>
            <X className="h-3.5 w-3.5" />
          </>
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
      {isActive && (
        <>
          <button
            type="button"
            onClick={restart}
            title={t('voice.restartSpeaking')}
            aria-label={t('voice.restartSpeaking')}
            className="inline-flex items-center rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {duration > 0 && (
            <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
          )}
        </>
      )}
    </span>
  );
};

export default MessageSpeakControl;
