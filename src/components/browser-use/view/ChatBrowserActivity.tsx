import { memo, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, CircleStop, Globe, Loader2, Trash2 } from 'lucide-react';

import type { ChatMessage } from '../../chat/types/types';
import type { ToolActivityItem } from '../../chat/utils/toolGrouping';
import OperationDetail from '../../chat/view/subcomponents/OperationDetail';
import { cn } from '../../../lib/utils';
import { authenticatedFetch } from '../../../utils/api';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import ContextMenuOverlay, { type ContextMenuAnchor } from '../../../shared/view/ui/ContextMenuOverlay';
import RowActionsTrigger from '../../../shared/view/ui/RowActionsTrigger';
import { isBrowserOpen, useChatBrowserState } from '../ChatBrowserContext';
import { describeBrowserStep, isBrowserCall, lastBrowserUrl, shortUrl } from '../browserSteps';

const LIVE_STEPS = 3;
// Fixed height; width follows the emulated viewport, so a phone page reads as portrait.
const SHOT_HEIGHT = 132;

type ChatBrowserActivityProps = {
  activity: ToolActivityItem;
  /** The newest activity of a run still in flight. */
  isLive?: boolean;
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
};

function SessionActions({ sessionId, site, canStop }: { sessionId: string; site: string; canStop: boolean }) {
  const [menuAnchor, setMenuAnchor] = useState<ContextMenuAnchor | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (path: string, method: 'POST' | 'DELETE') => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/browser-use/sessions/${encodeURIComponent(sessionId)}${path}`, { method });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.error || `Request failed (${response.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser action failed');
    } finally {
      setIsBusy(false);
    }
  };

  const actions = [
    { key: 'stop', label: 'Stop session', icon: CircleStop, disabled: isBusy || !canStop, onSelect: () => void runAction('/stop', 'POST') },
    { key: 'delete', label: 'Delete session', icon: Trash2, isDanger: true, disabled: isBusy, onSelect: () => setIsConfirmingDelete(true) },
  ];

  return (
    <>
      <RowActionsTrigger
        label={`Actions for browser session ${site}`}
        isOpen={Boolean(menuAnchor)}
        onOpen={setMenuAnchor}
        className="opacity-100"
      />
      {error && <span className="sr-only" role="alert">{error}</span>}
      {menuAnchor && (
        <ContextMenuOverlay
          anchor={menuAnchor}
          onDismiss={() => setMenuAnchor(null)}
          ariaLabel="Browser session actions"
          className="min-w-[200px] px-1 py-1"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => { setMenuAnchor(null); action.onSelect(); }}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                'focus:bg-accent focus:outline-none',
                action.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : action.isDanger
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                    : 'hover:bg-accent',
              )}
            >
              <action.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{action.label}</span>
            </button>
          ))}
        </ContextMenuOverlay>
      )}
      <Dialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete this browser session?</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {site} closes and its screenshot and action history are removed. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsConfirmingDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isBusy}
              onClick={() => { setIsConfirmingDelete(false); void runAction('', 'DELETE'); }}
            >
              <Trash2 className="h-4 w-4" />
              Delete session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StepList({ calls, start, getMessageKey, onFileOpen, isLive }: {
  calls: ChatMessage[];
  start: number;
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  isLive: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <ol className="mt-1 space-y-0.5 text-[13px]">
      {calls.map((call, index) => {
        const key = getMessageKey(call);
        const failed = Boolean(call.toolResult?.isError);
        const isLast = index === calls.length - 1;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => setOpenKey((current) => (current === key ? null : key))}
              aria-expanded={openKey === key}
              className={cn(
                'flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/60',
                isLive && isLast ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <span className="w-5 flex-shrink-0 text-right tabular-nums text-muted-foreground/70">{start + index + 1}.</span>
              <span className="min-w-0 flex-1 break-words">
                {describeBrowserStep(call)}
                {failed && <span className="text-red-600 dark:text-red-400"> · failed</span>}
              </span>
            </button>
            {openKey === key && <div className="ml-7"><OperationDetail message={call} onFileOpen={onFileOpen} /></div>}
          </li>
        );
      })}
    </ol>
  );
}

const ChatBrowserActivity = memo(function ChatBrowserActivity({
  activity,
  isLive = false,
  getMessageKey,
  onFileOpen,
}: ChatBrowserActivityProps) {
  const browser = useChatBrowserState();
  const [isExpanded, setIsExpanded] = useState(false);
  const calls = activity.messages.filter(isBrowserCall);
  const count = calls.length;
  const stepsLabel = `${count} step${count === 1 ? '' : 's'}`;
  const { session, onOpen } = browser;
  const open = isBrowserOpen(browser);
  const runUrl = lastBrowserUrl(calls);

  if (isLive) {
    const hidden = isExpanded ? 0 : Math.max(0, count - LIVE_STEPS);
    const site = session?.title || (session?.url ? shortUrl(session.url) : runUrl) || 'No page open';
    const viewport = session?.viewport;
    return (
      <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={activity.timestamp || undefined}>
        <div className="my-1 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-10 items-center gap-2 pl-3 pr-1 text-sm">
            <Loader2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
            <span className="font-medium text-foreground" role="status">Using the browser</span>
            <span className="flex-1 text-xs text-muted-foreground">{stepsLabel}</span>
            {session && onOpen && (
              <button
                type="button"
                onClick={() => onOpen(session.id)}
                aria-label="Open in Browser"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            )}
            {session && <SessionActions sessionId={session.id} site={site} canStop={open} />}
          </div>
          <div className="flex gap-3 px-2.5 pb-2.5">
            <button
              type="button"
              disabled={!session || !onOpen}
              onClick={() => session && onOpen?.(session.id)}
              aria-label={`${site}. Open in Browser`}
              className="flex max-w-[45%] flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
              style={{ height: SHOT_HEIGHT, aspectRatio: viewport ? `${viewport.width} / ${viewport.height}` : '390 / 844' }}
            >
              {session?.screenshotDataUrl
                ? <img src={session.screenshotDataUrl} alt="" className="h-full w-full object-cover object-top" />
                : <Globe className="h-5 w-5 text-muted-foreground" aria-hidden />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-muted-foreground">{session?.url ? shortUrl(session.url) : runUrl}</div>
              {count > LIVE_STEPS && (
                <button
                  type="button"
                  onClick={() => setIsExpanded((current) => !current)}
                  className="mt-1 flex items-center gap-1 text-xs text-primary"
                >
                  {isExpanded ? 'Show fewer' : `${hidden} earlier step${hidden === 1 ? '' : 's'}`}
                  <ChevronDown className={cn('h-3 w-3', isExpanded && 'rotate-180')} aria-hidden />
                </button>
              )}
              <StepList calls={calls.slice(hidden)} start={hidden} getMessageKey={getMessageKey} onFileOpen={onFileOpen} isLive />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const failed = calls.filter((call) => call.toolResult?.isError).length;
  const cutShort = calls.some((call) => !call.toolResult);
  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={activity.timestamp || undefined}>
      <div className="my-1 overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm text-muted-foreground hover:bg-accent/40"
        >
          <Globe className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="font-medium text-foreground">Used the browser</span>
          <span className="flex-1 text-xs">
            {stepsLabel}
            {failed > 0 && <span className="text-red-600 dark:text-red-400"> · {failed} failed</span>}
          </span>
          <ChevronDown className={cn('h-4 w-4 flex-shrink-0 transition-transform', isExpanded && 'rotate-180')} aria-hidden />
        </button>
        {isExpanded && (
          <div className="border-t border-border/60 px-2 pb-2.5 pt-1">
            <StepList calls={calls} start={0} getMessageKey={getMessageKey} onFileOpen={onFileOpen} isLive={false} />
            <div className="mt-2 flex items-center gap-1.5 px-1 text-[13px] text-foreground">
              {cutShort
                ? <><CircleStop className="h-3.5 w-3.5 flex-shrink-0" aria-hidden /> Stopped before it finished</>
                : <><Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden /> {runUrl ? `Finished on ${runUrl}` : 'Finished'}</>}
            </div>
            {open && session && onOpen && (
              <button
                type="button"
                onClick={() => onOpen(session.id)}
                className="mt-1.5 flex items-center gap-1 px-1 text-[13px] text-primary"
              >
                Open in Browser
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatBrowserActivity;
