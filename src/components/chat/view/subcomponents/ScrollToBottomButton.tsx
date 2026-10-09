import { useEffect, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { TurnEnd } from '../../types/types';
import { dotStateFor, endingFor } from '../../utils/activityState';

import ActivityDots from './ActivityDots';

type ScrollToBottomButtonProps = {
  activity: SessionActivity | null;
  awaitingInput: boolean;
  turnEnd: TurnEnd | null;
  onClick: () => void;
};

/**
 * Jump-to-bottom control that carries the turn's activity dots while scrolled up.
 * A turn's ending stays on it until it unmounts, which is when the user is back at the bottom.
 */
export default function ScrollToBottomButton({ activity, awaitingInput, turnEnd, onClick }: ScrollToBottomButtonProps) {
  const { t } = useTranslation('chat');
  const [lastActivity, setLastActivity] = useState<SessionActivity | null>(activity);

  useEffect(() => {
    if (activity) setLastActivity(activity);
  }, [activity]);

  const ending = !activity && lastActivity ? endingFor(lastActivity, turnEnd) : null;
  const dotState = activity ? dotStateFor(activity, awaitingInput, null) : ending;
  const label = t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' });

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-activity={dotState ?? undefined}
      className={`pointer-events-auto relative flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-300 hover:bg-accent hover:text-foreground ${dotState ? '-translate-y-2.5' : ''}`}
    >
      {dotState ? (
        <>
          <ActivityDots state={dotState} />
          {/* Outside the circle but inside the button, so it stays part of the tap target. */}
          <ChevronDownIcon className="absolute left-1/2 top-full mt-0.5 h-3.5 w-3.5 -translate-x-1/2" aria-hidden />
        </>
      ) : (
        <ChevronDownIcon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
