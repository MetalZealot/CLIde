import type { SessionActivity } from '../../../hooks/useSessionProtection';
import type { TurnEnd } from '../types/types';
import type { ActivityDotState } from '../view/subcomponents/ActivityDots';

export type Finish = 'done' | 'failed';

export const dotStateFor = (activity: SessionActivity, awaitingInput: boolean, finish: Finish | null): ActivityDotState => {
  if (finish) return finish;
  if (awaitingInput) return 'waiting';
  switch (activity.stage?.name) {
    case 'starting':
    case 'sending':
      return 'starting';
    case 'thinking':
    case 'retrying':
    case 'compacting':
      return activity.stage.name;
    default:
      return 'working';
  }
};

// Only an ending reported after this turn began belongs to it; a stop has no ending.
export const endingFor = (activity: SessionActivity, turnEnd: TurnEnd | null): Finish | null => (
  turnEnd && turnEnd.endedAt >= activity.startedAt && turnEnd.outcome !== 'stopped' ? turnEnd.outcome : null
);
