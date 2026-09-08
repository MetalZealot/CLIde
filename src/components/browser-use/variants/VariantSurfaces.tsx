// Temporary variant harness. Three structural answers to one question:
// how the capture gets the screen. Deleted when one is promoted.
// Self-contained by design — it must not import from the panel it replaces.
import { ChevronRight, CircleStop, Expand, ExternalLink, Monitor, MonitorPlay, MoreVertical, Settings, Smartphone, Tablet, Trash2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Badge, Button } from '../../../shared/view/ui';
import ActionMenu, { type ActionMenuItem } from '../../../shared/view/ui/ActionMenu';

import type { VariantName } from './VariantPicker';

type VariantSession = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  profileName: string | null;
  device: 'desktop' | 'phone' | 'tablet';
  actions: { tool: string; ok: boolean; at: string }[];
  viewport: { width: number; height: number } | null;
};

type SurfaceProps = {
  sessions: VariantSession[];
  selected: VariantSession | null;
  isBusy: boolean;
  onSelect: (id: string) => void;
  onFullscreen: () => void;
  onStop: () => void;
  onRequestDelete: () => void;
  onShowSettings?: (tab?: string) => void;
};

const DEVICE_ICONS = { desktop: Monitor, phone: Smartphone, tablet: Tablet } as const;

function domainOf(url: string | null): string {
  if (!url) return 'No page loaded';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function actionText(action: string | null): string {
  if (!action) return 'Waiting';
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}

function toolText(tool: string): string {
  return tool.replace(/^browser_/, '').replace(/_/g, ' ');
}

function clockText(value: string): string {
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

function nameOf(session: VariantSession | null): string {
  return session?.title || domainOf(session?.url || null);
}

function DeviceLabel({ session }: { session: VariantSession }) {
  const Icon = DEVICE_ICONS[session.device] || Monitor;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Icon className="h-3 w-3" />
      {session.viewport ? `${session.viewport.width}×${session.viewport.height}` : session.device}
    </span>
  );
}

function Capture({ session, className }: { session: VariantSession | null; className?: string }) {
  if (session?.screenshotDataUrl) {
    return (
      <img
        src={session.screenshotDataUrl}
        alt={`Latest capture of ${nameOf(session)}`}
        className={cn('block w-full outline outline-1 -outline-offset-1 outline-white/10', className)}
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center bg-neutral-950 px-6 py-16 text-center">
      <MonitorPlay className="h-9 w-9 text-neutral-500" />
      <div className="mt-3 text-sm font-medium text-neutral-100">{session?.message || 'Waiting for screenshot'}</div>
      <p className="mt-1 text-xs text-neutral-400">The next agent browser snapshot renders here.</p>
    </div>
  );
}

function sessionMenuItems(
  session: VariantSession | null,
  { isBusy, onStop, onRequestDelete, onShowSettings }: Pick<SurfaceProps, 'isBusy' | 'onStop' | 'onRequestDelete' | 'onShowSettings'>,
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [
    {
      key: 'stop',
      label: 'Stop session',
      icon: CircleStop,
      onSelect: onStop,
      disabled: isBusy || !session || session.status !== 'ready',
    },
    {
      key: 'delete',
      label: 'Delete session',
      icon: Trash2,
      onSelect: onRequestDelete,
      disabled: isBusy || !session,
      isDanger: true,
    },
  ];
  if (onShowSettings) {
    items.push({
      key: 'settings',
      label: 'Browser settings',
      icon: Settings,
      onSelect: () => onShowSettings('browser'),
      showDividerBefore: true,
    });
  }
  return items;
}

function Controls({
  isBusy,
  selected,
  onFullscreen,
  onStop,
  onRequestDelete,
  tone = 'default',
}: Pick<SurfaceProps, 'isBusy' | 'selected' | 'onFullscreen' | 'onStop' | 'onRequestDelete'> & { tone?: 'default' | 'onImage' }) {
  const base = tone === 'onImage' ? 'text-white hover:bg-white/20 hover:text-white' : '';
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Button variant="ghost" size="sm" className={cn('composer-send-hit-target h-8 w-8 p-0', base)} onClick={onFullscreen} disabled={!selected?.screenshotDataUrl} title="Full screen" aria-label="Full screen">
        <Expand className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" className={cn('composer-send-hit-target h-8 w-8 p-0', base)} onClick={onStop} disabled={isBusy || !selected || selected.status !== 'ready'} title="Stop session" aria-label="Stop session">
        <CircleStop className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn('composer-send-hit-target h-8 w-8 p-0', tone === 'onImage' ? 'text-red-300 hover:bg-red-500/20 hover:text-red-200' : 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
        onClick={onRequestDelete}
        disabled={isBusy || !selected}
        title="Delete session"
        aria-label="Delete session"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* Filled — the capture is the surface. The bar over it is an address bar:
   identity and one look-closer control. Everything else lives in a menu, on
   the row that represents the session. */
function Filled(props: SurfaceProps) {
  const { sessions, selected, onSelect, onFullscreen, isBusy } = props;
  const manySessions = sessions.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-950">
      {manySessions && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-2 py-1.5">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'flex min-w-[10rem] shrink-0 items-center gap-1 rounded-md border pl-2.5 pr-1',
                selected?.id === session.id ? 'border-white/40 bg-white/10' : 'border-white/15',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                aria-current={selected?.id === session.id ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-white" title={nameOf(session)}>
                  {nameOf(session)}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/50">{session.status}</span>
              </button>
              <ActionMenu
                label=""
                icon={MoreVertical}
                ariaLabel={`Actions for ${nameOf(session)}`}
                items={sessionMenuItems(session, { ...props, onStop: () => { onSelect(session.id); props.onStop(); }, onRequestDelete: () => { onSelect(session.id); props.onRequestDelete(); } })}
                variant="ghost"
                size="sm"
                triggerClassName="composer-send-hit-target h-8 w-8 p-0 text-white/70 hover:bg-white/20 hover:text-white [&>svg:last-child]:hidden"
              />
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-black/80 px-3 py-2">
            <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
              {selected?.status || 'empty'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white" title={nameOf(selected)}>
                {nameOf(selected)}
              </div>
              <div className="truncate text-xs text-white/60" title={selected?.url || undefined}>
                {selected?.url || 'No page loaded'}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="composer-send-hit-target h-8 w-8 shrink-0 p-0 text-white hover:bg-white/20 hover:text-white"
              onClick={onFullscreen}
              disabled={!selected?.screenshotDataUrl}
              title="Full screen"
              aria-label="Full screen"
            >
              <Expand className="h-4 w-4" />
            </Button>
            {!manySessions && (
              <ActionMenu
                label=""
                icon={MoreVertical}
                ariaLabel={`Actions for ${nameOf(selected)}`}
                items={sessionMenuItems(selected, props)}
                variant="ghost"
                size="sm"
                disabled={isBusy && !selected}
                triggerClassName="composer-send-hit-target h-8 w-8 p-0 text-white hover:bg-white/20 hover:text-white [&>svg:last-child]:hidden"
              />
            )}
          </div>
          <Capture session={selected} />
          {selected && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/60">
              <DeviceLabel session={selected} />
              <span className="truncate">{actionText(selected.lastAction)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Ledger — what the agent did is the content; the capture is its evidence. */
function Ledger(props: SurfaceProps) {
  const { selected } = props;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-md border border-border bg-background">
        <div className="border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0 text-[10px]">{selected?.status || 'empty'}</Badge>
            <div className="min-w-0 flex-1 truncate text-sm font-medium" title={nameOf(selected)}>
              {nameOf(selected)}
            </div>
            <Controls {...props} />
          </div>
          {selected?.url && (
            <a href={selected.url} target="_blank" rel="noopener noreferrer" title={selected.url} className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selected.url}</span>
            </a>
          )}
        </div>
        <Capture session={selected} />
        <div className="flex items-center gap-3 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {selected && <DeviceLabel session={selected} />}
          <span className="truncate">{actionText(selected?.lastAction || null)}</span>
          <span className="ml-auto shrink-0">{selected?.profileName || 'Temporary'}</span>
        </div>
        {selected && selected.actions.length > 0 && (
          <ol className="border-t border-border/60 px-3 py-2">
            {[...selected.actions].reverse().slice(0, 6).map((action, index) => (
              <li key={`${action.at}-${index}`} className="flex items-baseline gap-2 py-0.5 text-xs">
                <span className={cn('h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full', action.ok ? 'bg-primary' : 'bg-destructive')} />
                <span className="truncate text-foreground">{toolText(action.tool)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{clockText(action.at)}</span>
                <span className="sr-only">{action.ok ? 'succeeded' : 'failed'}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* Roll — every session is a row with its own thumbnail; no single hero. */
function Roll(props: SurfaceProps) {
  const { sessions, selected, onSelect, onFullscreen } = props;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
      <ul className="mx-auto flex max-w-7xl flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => { onSelect(session.id); if (session.screenshotDataUrl) onFullscreen(); }}
              className={cn(
                'flex w-full items-stretch gap-3 overflow-hidden rounded-md border bg-background p-2 text-left',
                selected?.id === session.id ? 'border-primary/50' : 'border-border',
              )}
            >
              <span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-950">
                {session.screenshotDataUrl ? (
                  <img src={session.screenshotDataUrl} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <MonitorPlay className="h-5 w-5 text-neutral-500" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground" title={nameOf(session)}>{nameOf(session)}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{session.status}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground" title={session.url || undefined}>{domainOf(session.url)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DeviceLabel session={session} />
                  <span className="truncate">{actionText(session.lastAction)}</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="mx-auto mt-3 flex max-w-7xl items-center justify-end">
          <Controls {...props} />
        </div>
      )}
    </div>
  );
}

export function VariantSurface({ variant, ...props }: SurfaceProps & { variant: VariantName }) {
  if (variant === 'filled') return <Filled {...props} />;
  if (variant === 'roll') return <Roll {...props} />;
  return <Ledger {...props} />;
}
