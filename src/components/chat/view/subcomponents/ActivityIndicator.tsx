import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
};

const EXIT_ANIMATION_MS = 220;

/**
 * The running turn's status as the conversation's last row: elapsed time, output
 * tokens, then what the provider reports it is doing, or "Working" when it reports nothing.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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

  if (!renderedActivity) return null;

  const stage = renderedActivity.stage ?? null;
  const stageLabel = !stage
    ? null
    : stage.name === 'starting'
      ? t('claudeStatus.stage.starting', { defaultValue: 'Starting' })
      : stage.name === 'sent'
        ? t('claudeStatus.stage.sent', { defaultValue: 'Sent' })
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
            : t('claudeStatus.stage.compacting', { defaultValue: 'Compacting' });
  const label = (
    stageLabel
    || renderedActivity.statusText
    || t('claudeStatus.actions.working', { defaultValue: 'Working' })
  ).replace(/\.+$/, '');

  const outputTokens = renderedActivity.outputTokens ?? 0;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const metrics = [
    minutes < 1
      ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
      : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' }),
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
      <div className="flex min-h-6 min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground sm:min-h-7 sm:text-sm">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <span className="shrink-0 whitespace-nowrap tabular-nums">{metrics} ·</span>
        <span className="min-w-0 flex-1 overflow-hidden" title={label}>
          <Shimmer className="block truncate">{`${label}…`}</Shimmer>
        </span>
      </div>
    </div>
  );
}
