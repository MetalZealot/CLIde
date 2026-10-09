import { useState } from 'react';
import { ArrowUpRight, CircleStop, Globe, Loader2, Trash2 } from 'lucide-react';

import type { BrowserSessionSummary } from '../../../../shared/browser-use';
import { cn } from '../../../lib/utils';
import { authenticatedFetch } from '../../../utils/api';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import ContextMenuOverlay, { type ContextMenuAnchor } from '../../../shared/view/ui/ContextMenuOverlay';
import RowActionsTrigger from '../../../shared/view/ui/RowActionsTrigger';

export default function ChatBrowserPreview({ session, unavailable, compact, onOpen }: {
  session: BrowserSessionSummary;
  unavailable: boolean;
  compact: boolean;
  onOpen: (id: string) => void;
}) {
  const [menuAnchor, setMenuAnchor] = useState<ContextMenuAnchor | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hides a deleted session until the next poll drops it.
  const [deletedId, setDeletedId] = useState<string | null>(null);

  const active = !unavailable && session.status === 'ready' && (session.activeToolCount ?? 0) > 0;
  const label = unavailable || session.status === 'unavailable' ? 'Browser unavailable'
    : session.status === 'stopped' ? 'Browser stopped'
      : active ? 'Using browser' : 'Browser idle';
  let site = session.title || 'No page open';
  if (!session.title && session.url) {
    try { site = new URL(session.url).hostname || session.url; } catch { site = session.url; }
  }

  const runAction = async (path: string, method: 'POST' | 'DELETE') => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/browser-use/sessions/${encodeURIComponent(session.id)}${path}`, { method });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.error || `Request failed (${response.status})`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser action failed');
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const deleteSession = async () => {
    setIsConfirmingDelete(false);
    if (await runAction('', 'DELETE')) setDeletedId(session.id);
  };

  if (deletedId === session.id) return null;

  const actions = [
    {
      key: 'stop',
      label: 'Stop session',
      icon: CircleStop,
      disabled: isBusy || unavailable || session.status !== 'ready',
      onSelect: () => void runAction('/stop', 'POST'),
    },
    {
      key: 'delete',
      label: 'Delete session',
      icon: Trash2,
      isDanger: true,
      disabled: isBusy,
      onSelect: () => setIsConfirmingDelete(true),
    },
  ];

  return (
    <div className="px-4 pb-2 md:px-6">
      <div className="mx-auto flex w-full max-w-[54.25rem] items-center rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => onOpen(session.id)}
          aria-label={`${label}: ${site}. Open in Browser`}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-xl text-left text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            compact ? 'min-h-7 px-2 py-1' : 'p-1.5',
          )}
        >
          {!compact && (
            // Fixed height, width from the emulated viewport, so a phone shot reads as portrait.
            <span
              className={cn('flex h-9 min-w-4 max-w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-muted', !session.viewport && 'w-14', !active && 'opacity-70')}
              style={session.viewport ? { aspectRatio: `${session.viewport.width} / ${session.viewport.height}` } : undefined}
            >
              {session.screenshotDataUrl
                ? <img src={session.screenshotDataUrl} alt="" className="h-full w-full object-cover object-top" />
                : <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />}
            </span>
          )}
          {(active || isBusy) && <Loader2 className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden />}
          <span className={cn('min-w-0 flex-1', compact && 'flex items-center gap-2')}>
            <span className="block shrink-0 font-medium" role="status">{label}</span>
            <span className="block truncate text-muted-foreground">{site}</span>
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <RowActionsTrigger
          label={`Actions for browser session ${site}`}
          isOpen={Boolean(menuAnchor)}
          onOpen={setMenuAnchor}
          className="mx-1 opacity-100"
        />
      </div>
      {error && <p className="mx-auto mt-1 max-w-[54.25rem] px-1 text-xs text-destructive" role="alert">{error}</p>}

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
            <Button variant="outline" size="sm" onClick={() => setIsConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void deleteSession()} disabled={isBusy}>
              <Trash2 className="h-4 w-4" />
              Delete session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
