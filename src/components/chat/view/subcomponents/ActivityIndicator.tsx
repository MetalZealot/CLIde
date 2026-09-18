import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SquareIcon } from 'lucide-react';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import {
  DEFAULT_THINKING_MESSAGES,
  shuffleThinkingMessageIndices,
  THINKING_MESSAGE_TRANSLATION_KEYS,
  useThinkingMessages,
} from '../../../../hooks/useThinkingMessages';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  /** Armed by the first Escape/tap: the button shows its label and goes live. */
  isStopArmed?: boolean;
};

const EXIT_ANIMATION_MS = 220;

/**
 * Response-in-progress indicator: a shimmering activity label, elapsed time, and a
 * Stop button. Sits in the message pane's layout gap (above the composer, below the
 * last message), so it consumes real vertical space rather than overlaying. The Stop
 * button lives here (not in the composer) so it stays reachable even while the user
 * is typing a follow-up — the composer's own button switches to queue mode then. The
 * button stays mounted (just invisible) when idle so the reserved gap keeps a
 * constant height between turns. Stopping takes two inputs: `isStopArmed` (owned by
 * ChatInterface, shared with the Escape handler) turns the icon-only button into a
 * labelled, live-coloured one; the caller aborts on the next tap.
 */
export default function ActivityIndicator({ activity, onAbort, isStopArmed = false }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const { customMessages, cycleMode, messageOrder } = useThinkingMessages();
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const previousStartedAtRef = useRef<number | null>(null);
  const randomBagRef = useRef<number[]>([]);
  const previousRandomIndexRef = useRef<number | null>(null);
  const randomMessageSetRef = useRef('');
  const processedRandomStepRef = useRef<string | null>(null);
  const [randomMessageIndex, setRandomMessageIndex] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (startedAt === null || previousStartedAtRef.current === startedAt) return;

    const isFirstTurn = previousStartedAtRef.current === null;
    previousStartedAtRef.current = startedAt;
    setTurnIndex((current) => isFirstTurn ? 0 : current + 1);
  }, [startedAt]);

  const translatedActionWords = THINKING_MESSAGE_TRANSLATION_KEYS.map((key, index) => (
    t(key, { defaultValue: DEFAULT_THINKING_MESSAGES[index] })
  ));
  const customActionWords = customMessages
    ?.map((message) => message.trim())
    .filter(Boolean);
  const actionWords = customActionWords?.length ? customActionWords : translatedActionWords;
  const listedMessageIndex = cycleMode === 'never'
    ? 0
    : cycleMode === 'turn'
      ? turnIndex % actionWords.length
      : Math.floor(elapsedSeconds / Number(cycleMode)) % actionWords.length;
  const randomStep = startedAt === null || cycleMode === 'never'
    ? null
    : cycleMode === 'turn'
      ? `turn:${startedAt}`
      : `time:${startedAt}:${cycleMode}:${Math.floor(elapsedSeconds / Number(cycleMode))}`;
  const actionWordsFingerprint = JSON.stringify(actionWords);

  // Editing the messages, the cycle, or the order restarts the list, so a settings
  // change proves itself on screen. Must run before the random pick below.
  useEffect(() => {
    setTurnIndex(0);
    setRandomMessageIndex(0);
    randomBagRef.current = [];
    previousRandomIndexRef.current = null;
    processedRandomStepRef.current = null;
  }, [actionWordsFingerprint, cycleMode, messageOrder]);

  useEffect(() => {
    if (messageOrder !== 'random' || randomStep === null) return;

    if (randomMessageSetRef.current !== actionWordsFingerprint) {
      randomBagRef.current = [];
      previousRandomIndexRef.current = null;
      randomMessageSetRef.current = actionWordsFingerprint;
      processedRandomStepRef.current = null;
    }

    if (processedRandomStepRef.current === randomStep) return;
    processedRandomStepRef.current = randomStep;

    if (randomBagRef.current.length === 0) {
      randomBagRef.current = shuffleThinkingMessageIndices(
        actionWords.length,
        previousRandomIndexRef.current,
      );
    }

    const nextIndex = randomBagRef.current.shift() ?? 0;
    previousRandomIndexRef.current = nextIndex;
    setRandomMessageIndex(nextIndex);
  }, [actionWords.length, actionWordsFingerprint, messageOrder, randomStep]);

  const messageIndex = messageOrder === 'random' && cycleMode !== 'never'
    ? randomMessageIndex
    : listedMessageIndex;
  // A reported stage outranks the cycling words: those are decoration, and a
  // turn that is retrying or silent must not read as one that is working.
  const stage = renderedActivity?.stage ?? null;
  const stageLabel = !stage
    ? null
    : stage.name === 'starting'
      ? t('claudeStatus.stage.starting', { defaultValue: 'Starting' })
      : stage.name === 'sent'
        ? t('claudeStatus.stage.sent', { defaultValue: 'Sent' })
        : stage.name === 'thinking'
          ? (typeof stage.tokens === 'number' && stage.tokens > 0
            ? t('claudeStatus.stage.thinkingTokens', {
              count: stage.tokens,
              tokens: stage.tokens.toLocaleString(),
              defaultValue: 'Thinking · {{tokens}} tokens',
            })
            : t('claudeStatus.stage.thinking', { defaultValue: 'Thinking' }))
          : stage.name === 'retrying'
            ? t('claudeStatus.stage.retrying', {
              reason: stage.reason || t('claudeStatus.stage.retryReasonFallback', { defaultValue: 'API error' }),
              attempt: stage.attempt ?? 1,
              maxAttempts: stage.maxAttempts ?? 1,
              defaultValue: 'Retrying · {{reason}} · {{attempt}} of {{maxAttempts}}',
            })
            : t('claudeStatus.stage.compacting', { defaultValue: 'Compacting' });
  const label = renderedActivity
    ? (stageLabel || renderedActivity.statusText || actionWords[messageIndex] || actionWords[0]).replace(/\.+$/, '')
    : '';

  const stopLabel = isStopArmed
    ? t('claudeStatus.stopConfirm', { defaultValue: 'Press again to stop' })
    : t('claudeStatus.stop', { defaultValue: 'Stop' });

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });

  return (
    <div
      className={`${
        renderedActivity && !isExiting ? 'chat-activity-enter' : 'chat-activity-exit'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1 text-xs">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <span className="min-w-0 overflow-hidden" title={renderedActivity ? label : undefined}>
          <Shimmer className="block truncate font-medium">{renderedActivity ? `${label}…` : ''}</Shimmer>
        </span>
        <span className="tabular-nums text-muted-foreground/60">{renderedActivity ? elapsedLabel : ''}</span>
        {onAbort && (
          <button
            type="button"
            onClick={onAbort}
            disabled={!renderedActivity?.canInterrupt}
            aria-label={stopLabel}
            title={stopLabel}
            className={`-my-1 ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border font-medium shadow-sm transition-colors ${
              isStopArmed
                ? 'border-foreground bg-foreground pl-2.5 pr-2 text-background'
                : 'border-border bg-background px-2 text-muted-foreground hover:bg-accent hover:text-foreground'
            } ${renderedActivity?.canInterrupt ? '' : 'invisible'}`}
          >
            {isStopArmed && t('claudeStatus.stop', { defaultValue: 'Stop' })}
            <SquareIcon className="h-3 w-3 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}
