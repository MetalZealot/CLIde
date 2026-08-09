import { AlertCircle, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { ActivityState } from '../../types/types';

type SidebarStatusIndicatorProps = {
  status: ActivityState;
  t: TFunction;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  labelPrefix?: string;
};

const containerSizes = {
  xs: 'h-4 w-4',
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
} as const;

const iconSizes = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
} as const;

const dotSizes = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
} as const;

const getSidebarStatusLabel = (status: ActivityState, t: TFunction): string => {
  if (status === 'blocked') return t('projects.activityBlocked', 'Blocked');
  if (status === 'running') return t('projects.activityRunning', 'Running');
  return t('projects.activityUnread', 'Unread finished');
};

/**
 * The sidebar's one non-colour status cue. Selection remains a row surface;
 * transient state stays in this fixed-size symbol slot.
 */
export default function SidebarStatusIndicator({
  status,
  t,
  size = 'sm',
  className,
  labelPrefix,
}: SidebarStatusIndicatorProps) {
  const label = getSidebarStatusLabel(status, t);
  const accessibleLabel = labelPrefix ? `${labelPrefix}: ${label}` : label;

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center',
        containerSizes[size],
        className,
      )}
    >
      {status === 'blocked' ? (
        <AlertCircle aria-hidden className={cn(iconSizes[size], 'text-status-attention')} />
      ) : status === 'running' ? (
        <Loader2 aria-hidden className={cn(iconSizes[size], 'animate-spin text-status-running')} />
      ) : (
        <span aria-hidden className={cn(dotSizes[size], 'rounded-full bg-status-unread')} />
      )}
    </span>
  );
}
