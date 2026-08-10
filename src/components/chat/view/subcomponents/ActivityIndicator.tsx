import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SquareIcon } from 'lucide-react';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  /** Armed by the first Escape/tap: the button shows its label and goes live. */
  isStopArmed?: boolean;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
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

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const label = renderedActivity
    ? (renderedActivity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length]).replace(/\.+$/, '')
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
        <Shimmer className="font-medium">{renderedActivity ? `${label}…` : ''}</Shimmer>
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
