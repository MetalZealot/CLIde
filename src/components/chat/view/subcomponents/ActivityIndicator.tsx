import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { TurnEnd } from '../../types/types';
import { dotStateFor, endingFor, type Finish } from '../../utils/activityState';

import ActivityDots from './ActivityDots';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  /** A permission prompt or question is open for this conversation. */
  awaitingInput?: boolean;
  /** How the viewed conversation's last turn ended; plays its ending before the row leaves. */
  turnEnd?: TurnEnd | null;
};

const EXIT_ANIMATION_MS = 220;
// Long enough for the dots to settle into their ending.
const FINISH_HOLD_MS = 1400;

/**
 * The running turn's status as the conversation's last row: elapsed time, output
 * tokens, then what the provider reports it is doing, or "Working" when it reports nothing.
 * A finished turn leaves at once, since its reply's summary row takes over; a failed one holds.
 */
export default function ActivityIndicator({ activity, awaitingInput = false, turnEnd = null }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [finish, setFinish] = useState<Finish | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  // Start-up has no clock, so the elapsed time matches the summary row, which counts from the prompt.
  const isStarting = renderedActivity?.stage?.name === 'starting';
  const startedAt = renderedActivity && !isStarting ? renderedActivity.readyAt ?? renderedActivity.startedAt : null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setFinish(null);
      setIsExiting(false);
      return undefined;
    }

    if (!renderedActivity) return undefined;

    const ending = endingFor(renderedActivity, turnEnd);
    if (ending === 'done') {
      setRenderedActivity(null);
      return undefined;
    }
    setFinish(ending);
    const holdMs = ending ? FINISH_HOLD_MS : 0;
    if (!ending) setIsExiting(true);
    const exitTimer = ending ? setTimeout(() => setIsExiting(true), holdMs) : undefined;
    const removeTimer = setTimeout(() => {
      setRenderedActivity(null);
      setFinish(null);
      setIsExiting(false);
    }, holdMs + EXIT_ANIMATION_MS);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [activity, renderedActivity, turnEnd]);

  useEffect(() => {
    if (startedAt === null) setElapsedSeconds(0);
    if (startedAt === null || finish) return undefined;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt, finish]);

  // Gone in the same frame the summary row appears, so the two never stack.
  if (!renderedActivity || (!activity && endingFor(renderedActivity, turnEnd) === 'done')) return null;

  const stage = renderedActivity.stage ?? null;
  const stageLabel = !stage
    ? null
    : stage.name === 'starting'
      ? t('claudeStatus.stage.starting', { defaultValue: 'Starting' })
      : stage.name === 'sending'
        ? t('claudeStatus.stage.sending', { defaultValue: 'Sending' })
        : stage.name === 'thinking'
          ? t('claudeStatus.stage.thinking', { defaultValue: 'Thinking' })
          : stage.name === 'retrying'
            // Codex reports no retry budget and a long reason, so the count leads and has no "of N".
            ? (stage.maxAttempts
              ? t('claudeStatus.stage.retrying', {
                reason: stage.reason || t('claudeStatus.stage.retryReasonFallback', { defaultValue: 'API error' }),
                attempt: stage.attempt ?? 1,
                maxAttempts: stage.maxAttempts,
                defaultValue: 'Retrying · {{reason}} · {{attempt}} of {{maxAttempts}}',
              })
              : t('claudeStatus.stage.retryingOpenEnded', {
                reason: stage.reason || t('claudeStatus.stage.retryReasonFallback', { defaultValue: 'API error' }),
                attempt: stage.attempt ?? 1,
                defaultValue: 'Retrying · attempt {{attempt}} · {{reason}}',
              }))
            : stage.name === 'background'
              ? t('claudeStatus.stage.background', { count: stage.count ?? 1 })
              : t('claudeStatus.stage.compacting', { defaultValue: 'Compacting' });
  // Streaming words are their own status, so the line names nothing while they arrive.
  const isWriting = !awaitingInput && stage?.name === 'writing';
  const liveLabel = isWriting ? '' : (
    (awaitingInput ? t('claudeStatus.waiting', { defaultValue: 'Waiting for you' }) : null)
    || stageLabel
    || renderedActivity.statusText
    || t('claudeStatus.actions.working', { defaultValue: 'Working' })
  ).replace(/\.+$/, '');
  const label = finish === 'failed' ? t('claudeStatus.finished.failed', { defaultValue: 'Failed' }) : liveLabel;

  const outputTokens = renderedActivity.outputTokens ?? 0;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const metrics = [
    isStarting ? '' : (minutes < 1
      ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
      : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' })),
    outputTokens > 0
      ? t('claudeStatus.outputTokens', {
        count: outputTokens,
        tokens: outputTokens.toLocaleString(),
        defaultValue: '{{tokens}} tokens',
      })
      : '',
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={`chat-message px-1 sm:px-0 ${isExiting ? 'chat-activity-exit' : 'chat-activity-enter'}`}
      role="status"
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2 text-chat-activity text-muted-foreground sm:min-h-7">
        <ActivityDots state={dotStateFor(renderedActivity, awaitingInput, finish)} />
        {metrics && (
          <span className="shrink-0 whitespace-nowrap tabular-nums">{label ? `${metrics} ·` : metrics}</span>
        )}
        {label && (
          <span className="min-w-0 flex-1 overflow-hidden" title={label}>
            {finish
              ? <span className="block truncate">{label}</span>
              : <Shimmer className="block truncate">{`${label}…`}</Shimmer>}
          </span>
        )}
      </div>
    </div>
  );
}
