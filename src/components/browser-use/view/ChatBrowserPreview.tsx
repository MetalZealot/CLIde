import { ArrowUpRight, Globe, Loader2 } from 'lucide-react';

import type { BrowserSessionSummary } from '../../../../shared/browser-use';
import { cn } from '../../../lib/utils';

export default function ChatBrowserPreview({ session, unavailable, compact, onOpen }: {
  session: BrowserSessionSummary;
  unavailable: boolean;
  compact: boolean;
  onOpen: (id: string) => void;
}) {
  const active = !unavailable && session.status === 'ready' && (session.activeToolCount ?? 0) > 0;
  const label = unavailable || session.status === 'unavailable' ? 'Browser unavailable'
    : session.status === 'stopped' ? 'Browser stopped'
      : active ? 'Using browser' : 'Browser idle';
  let site = session.title || 'No page open';
  if (!session.title && session.url) {
    try { site = new URL(session.url).hostname || session.url; } catch { site = session.url; }
  }

  return (
    <div className="px-4 pb-2 md:px-6">
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        aria-label={`${label}: ${site}. Open in Browser`}
        className={cn(
          'mx-auto flex w-full max-w-[54.25rem] items-center gap-2 rounded-lg border border-border bg-card text-left text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'min-h-7 px-2 py-1' : 'p-1.5',
        )}
      >
        {!compact && (
          <span className={cn('flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted', !active && 'opacity-70')}>
            {session.screenshotDataUrl
              ? <img src={session.screenshotDataUrl} alt="" className="h-full w-full object-cover object-top" />
              : <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />}
          </span>
        )}
        {active && <Loader2 className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden />}
        <span className={cn('min-w-0 flex-1', compact && 'flex items-center gap-2')}>
          <span className="block shrink-0 font-medium" role="status">{label}</span>
          <span className="block truncate text-muted-foreground">{site}</span>
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}
