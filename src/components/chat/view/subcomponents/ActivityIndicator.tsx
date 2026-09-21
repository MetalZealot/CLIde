import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
};

const EXIT_ANIMATION_MS = 220;

/**
 * Response-in-progress indicator: a shimmering activity label on the left, the
 * turn's output tokens and elapsed time pinned right. Sits in the layout gap above
 * the composer, so it takes real vertical space rather than overlaying. Stop lives
 * in the composer's send button.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
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
          ? t('claudeStatus.stage.thinking', { defaultValue: 'Thinking' })
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

  const outputTokens = renderedActivity?.outputTokens ?? 0;
  const outputTokensLabel = outputTokens > 0
    ? t('claudeStatus.outputTokens', {
      count: outputTokens,
      tokens: outputTokens.toLocaleString(),
      defaultValue: '{{tokens}} tokens',
    })
    : '';

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
        <span className="min-w-0 flex-1 overflow-hidden" title={renderedActivity ? label : undefined}>
          <Shimmer className="block truncate font-medium">{renderedActivity ? `${label}…` : ''}</Shimmer>
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground/60">
          {outputTokensLabel && `${outputTokensLabel} · `}
          {renderedActivity ? elapsedLabel : ''}
        </span>
      </div>
    </div>
  );
}
