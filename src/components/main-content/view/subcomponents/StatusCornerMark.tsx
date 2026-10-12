import { AlertCircle, Clock } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type CornerMarkStatus = 'blocked' | 'unread' | 'scheduled';

/** A session status pinned to a nav icon's corner; the caller positions it. */
export default function StatusCornerMark({ status, className }: { status: CornerMarkStatus; className?: string }) {
  if (status === 'unread') {
    return <span aria-hidden="true" className={cn('absolute h-2 w-2 rounded-full bg-status-unread ring-2 ring-background', className)} />;
  }

  const Icon = status === 'blocked' ? AlertCircle : Clock;
  return (
    <span aria-hidden="true" className={cn('absolute flex h-4 w-4 items-center justify-center rounded-full bg-background', className)}>
      <Icon className={cn('h-3 w-3', status === 'blocked' ? 'text-status-attention' : 'text-status-running')} />
    </span>
  );
}
