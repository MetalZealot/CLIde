import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CircleStop,
  Clock3,
  Smartphone,
  Tablet,
  Monitor,
  Download,
  Expand,
  ExternalLink,
  Loader2,
  MonitorPlay,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Badge, Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import ContextMenuOverlay, { anchorFromElement, type ContextMenuAnchor } from '../../../shared/view/ui/ContextMenuOverlay';
import RowActionsTrigger from '../../../shared/view/ui/RowActionsTrigger';
import { authenticatedFetch } from '../../../utils/api';
import { useLongPress } from '../../../hooks/useLongPress';

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  sessionCount: number;
  message: string;
};

type BrowserAgentAction = {
  tool: string;
  ok: boolean;
  at: string;
};

type BrowserUseSession = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  createdBy: 'agent';
  profileName: string | null;
  device: 'desktop' | 'phone' | 'tablet';
  screenshotVersion: number;
  actions: BrowserAgentAction[];
  viewport: {
    width: number;
    height: number;
  } | null;
};

type BrowserUsePanelProps = {
  isVisible: boolean;
  onShowSettings?: (tab?: string) => void;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Never';

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown';

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 10) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
}

const DEVICE_ICONS = {
  desktop: Monitor,
  phone: Smartphone,
  tablet: Tablet,
} as const;

// Playwright MCP tool names read as machine identifiers; the trail is for
// glancing at, so drop the prefix and the underscores.
function formatToolName(tool: string): string {
  return tool.replace(/^browser_/, '').replace(/_/g, ' ');
}

function formatClockTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getDomain(url: string | null): string {
  if (!url) return 'No page loaded';

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatAction(action: string | null): string {
  if (!action) return 'Waiting';
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}


function getRuntimeTone(status: BrowserUseStatus | null, installing: boolean): string {
  if (!status?.enabled) return 'border-border bg-muted text-muted-foreground';
  if (status.available) return 'border-primary/30 bg-primary/5 text-foreground';
  if (status.installInProgress || installing) return 'border-primary/30 bg-primary/5 text-foreground';
  return 'border-border bg-background text-muted-foreground';
}

function getStatusDot(status: BrowserUseSession['status']): string {
  if (status === 'ready') return 'bg-primary';
  if (status === 'stopped') return 'bg-muted-foreground/50';
  return 'bg-border';
}

// Fast enough to feel live on a phone, slow enough that a poll costs metadata
// only; images arrive on their own version change.
const LIVE_POLL_MS = 2_000;

const PROMPTS = [
  'Use Browser to inspect the checkout flow and report any broken UI states.',
  'Open <url> with Browser, interact with the page, and summarize what changed after each step.',
];

/**
 * One session in the mobile picker. Tap selects; long-press, right-click and
 * the kebab all raise the same menu, so acting on a session belongs to its own
 * row rather than to the address bar above the capture.
 */
function SessionChip({
  session,
  isSelected,
  isMenuOpen,
  onSelect,
  onOpenMenu,
}: {
  session: BrowserUseSession;
  isSelected: boolean;
  isMenuOpen: boolean;
  onSelect: () => void;
  onOpenMenu: (session: BrowserUseSession, anchor: ContextMenuAnchor) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // useLongPress supplies the right-click path too, so one handler set covers
  // long-press and context menu; the kebab passes its own anchor.
  const { handlers: longPress } = useLongPress(
    (coords) => onOpenMenu(session, anchorFromElement(rowRef.current, coords)),
  );

  return (
    <div
      ref={rowRef}
      className={cn(
        'flex min-w-[10rem] shrink-0 items-center gap-1 rounded-md border pl-2.5 pr-1',
        isSelected ? 'border-white/40 bg-white/10' : 'border-white/15',
      )}
      {...longPress}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white" title={session.title || getDomain(session.url)}>
          {session.title || getDomain(session.url)}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/50">{session.status}</span>
      </button>
      <RowActionsTrigger
        label={`Actions for ${session.title || getDomain(session.url)}`}
        isOpen={isMenuOpen}
        onOpen={(anchor) => onOpenMenu(session, anchor)}
        className="text-white/80 hover:bg-white/20 hover:text-white"
      />
    </div>
  );
}

export default function BrowserUsePanel({ isVisible, onShowSettings }: BrowserUsePanelProps) {
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [sessions, setSessions] = useState<BrowserUseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [actionMenu, setActionMenu] = useState<{ sessionId: string; anchor: ContextMenuAnchor } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionsRef = useRef<BrowserUseSession[]>([]);
  sessionsRef.current = sessions;

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const activeSessions = sessions.filter((session) => session.status === 'ready');
  const needsBrowserBinaries = Boolean(status?.enabled && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = !status?.enabled
    ? 'Disabled'
    : status.available
      ? 'Ready'
      : status.installInProgress || isInstalling
        ? 'Installing'
        : 'Setup required';

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, sessionsResponse] = await Promise.all([
        authenticatedFetch('/api/browser-use/status'),
        authenticatedFetch('/api/browser-use/sessions'),
      ]);
      const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
      const sessionsData = await readJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
      const nextSessions = sessionsData.data.sessions;
      setStatus(statusData.data);
      setSessions(nextSessions);
      setSelectedSessionId((current) => (
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id || null
      ));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Browser. Check that it is enabled in settings, then refresh.');
    }
  }, []);

  const pollSummary = useCallback(async () => {
    const response = await authenticatedFetch('/api/browser-use/sessions?view=summary');
    const data = await readJson<{ data: { sessions: BrowserUseSession[] } }>(response);
    const summaries = data.data.sessions;

    setSessions((current) => summaries.map((summary) => {
      const previous = current.find((session) => session.id === summary.id);
      // The summary carries no image, so keep the one already on screen until
      // its version says a newer capture exists.
      return previous && previous.screenshotVersion === summary.screenshotVersion
        ? { ...summary, screenshotDataUrl: previous.screenshotDataUrl }
        : summary;
    }));

    const stale = summaries.filter((summary) => {
      const previous = sessionsRef.current.find((session) => session.id === summary.id);
      return summary.screenshotVersion > 0 && (!previous || previous.screenshotVersion !== summary.screenshotVersion);
    });
    for (const summary of stale) {
      const full = await authenticatedFetch(`/api/browser-use/sessions/${summary.id}`);
      const session = (await readJson<{ data: { session: BrowserUseSession } }>(full)).data.session;
      setSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    void refresh();
  }, [isVisible, refresh]);

  // Opening the tab shows current state, and it keeps up on its own while the
  // tab is on screen. Hidden tabs poll nothing.
  useEffect(() => {
    if (!isVisible) return undefined;
    const timer = setInterval(() => {
      void pollSummary().catch(() => undefined);
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [isVisible, pollSummary]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser action failed. Refresh to see the session\u2019s current state, then try again.');
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/stop`, { method: 'POST' });
    await readJson(response);
  });

  const deleteSession = () => runAction(async () => {
    setIsConfirmingDelete(false);
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}`, { method: 'DELETE' });
    await readJson(response);
    setIsFullscreen(false);
  });

  const installBrowserBinaries = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response);
    } finally {
      setIsInstalling(false);
    }
  });

  const renderSessionItem = (session: BrowserUseSession) => {
    const isSelected = selectedSession?.id === session.id;
    return (
      <button
        key={session.id}
        type="button"
        onClick={() => setSelectedSessionId(session.id)}
        className={cn(
          'group w-full rounded-md border px-3 py-2.5 text-left transition-colors',
          isSelected
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border/60 bg-card/30 text-muted-foreground hover:bg-muted/50',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStatusDot(session.status))} />
              <div className="truncate text-sm font-medium" title={session.title || getDomain(session.url)}>
                {session.title || getDomain(session.url)}
              </div>
            </div>
            <div className="mt-1 truncate pl-3.5 text-xs text-muted-foreground">{getDomain(session.url)}</div>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-background text-[10px] text-muted-foreground">
            {session.status}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span>{formatRelativeTime(session.updatedAt)}</span>
          <span className="truncate">- {formatAction(session.lastAction)}</span>
        </div>
      </button>
    );
  };

  const renderEmptyState = () => (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-md border border-border bg-card/40 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <MonitorPlay className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {status?.enabled ? 'No browser sessions yet' : 'Browser is disabled'}
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {status?.enabled
                ? 'Agent browser sessions appear here while an AI task is using Browser.'
                : 'Enable Browser in settings to let agents open monitored browser sessions.'}
            </p>
          </div>
        </div>

        {needsBrowserBinaries && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium text-foreground">Runtime setup required</div>
            <p className="mt-1 text-sm text-muted-foreground">{status?.message}</p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={installBrowserBinaries}
              disabled={isBusy || isInstalling || status?.installInProgress}
            >
              {isInstalling || status?.installInProgress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isInstalling || status?.installInProgress ? 'Installing...' : 'Install Runtime'}
            </Button>
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((prompt) => (
            <div key={prompt} className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                Prompt
              </div>
              <p className="text-sm leading-6 text-foreground">{prompt}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const sessionMenuActions = (session: BrowserUseSession | null) => [
    {
      key: 'stop',
      label: 'Stop session',
      icon: CircleStop,
      disabled: isBusy || !session || session.status !== 'ready',
      onSelect: stopSession,
    },
    {
      key: 'delete',
      label: 'Delete session',
      icon: Trash2,
      isDanger: true,
      disabled: isBusy || !session,
      onSelect: () => setIsConfirmingDelete(true),
    },
    ...(onShowSettings
      ? [{
          key: 'settings',
          label: 'Browser settings',
          icon: Settings,
          showDividerBefore: true,
          disabled: false,
          onSelect: () => onShowSettings('browser'),
        }]
      : []),
  ];

  const openSessionMenu = (session: BrowserUseSession, anchor: ContextMenuAnchor) => {
    setSelectedSessionId(session.id);
    setActionMenu({ sessionId: session.id, anchor });
  };

  const menuSession = actionMenu ? sessions.find((item) => item.id === actionMenu.sessionId) || null : null;

  // The capture is the surface: full column width, height from its own aspect,
  // so nothing is letterboxed and no minimum reserves empty space.
  const renderCapture = () => (
    selectedSession?.screenshotDataUrl ? (
      <img
        src={selectedSession.screenshotDataUrl}
        alt={`Latest capture of ${selectedSession.title || getDomain(selectedSession.url)}`}
        className="block w-full outline outline-1 -outline-offset-1 outline-white/10"
      />
    ) : (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <MonitorPlay className="h-9 w-9 text-neutral-500" />
        <div className="mt-3 text-sm font-medium text-neutral-100">{selectedSession?.message || 'Waiting for screenshot'}</div>
        <p className="mt-1 text-xs text-neutral-400">The next agent browser snapshot renders here.</p>
      </div>
    )
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {runtimeLabel !== 'Ready' && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2 text-xs">
          <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
          <Badge variant="outline" className={cn('shrink-0 text-[10px]', getRuntimeTone(status, isInstalling))}>
            {runtimeLabel}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{status?.message || 'Browser is not ready.'}</span>
          {needsBrowserBinaries && (
            <Button type="button" size="sm" className="h-7 shrink-0" onClick={installBrowserBinaries} disabled={isBusy || isInstalling || status?.installInProgress}>
              {isInstalling || status?.installInProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isInstalling || status?.installInProgress ? 'Installing...' : 'Install'}
            </Button>
          )}
          {onShowSettings && (
            <Button variant="ghost" size="sm" className="composer-send-hit-target h-8 w-8 shrink-0 p-0" onClick={() => onShowSettings('browser')} title="Open Browser settings" aria-label="Open Browser settings">
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className={cn('flex min-h-0 flex-col overflow-hidden', sessions.length > 0 && 'bg-neutral-950')}>
          {sessions.length === 0 ? (
            renderEmptyState()
          ) : (
            <>
              {/* Session picker. Desktop has the sidebar list, and one session
                  needs no picker at all. */}
              {sessions.length > 1 && (
                <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-2 py-1.5 lg:hidden">
                  {sessions.map((session) => (
                    <SessionChip
                      key={session.id}
                      session={session}
                      isSelected={selectedSession?.id === session.id}
                      isMenuOpen={actionMenu?.sessionId === session.id}
                      onSelect={() => setSelectedSessionId(session.id)}
                      onOpenMenu={openSessionMenu}
                    />
                  ))}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto max-w-7xl">
                  {/* An address bar: what this is and one way to look closer.
                      Acting on the session belongs to its own row's menu. */}
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-black/80 px-3 py-2">
                    <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                      {selectedSession?.status || 'empty'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white" title={selectedSession?.title || getDomain(selectedSession?.url || null)}>
                        {selectedSession?.title || getDomain(selectedSession?.url || null)}
                      </div>
                      {selectedSession?.url ? (
                        <a
                          href={selectedSession.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={selectedSession.url}
                          className="flex min-w-0 items-center gap-1.5 text-xs text-white/60 hover:text-white hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{selectedSession.url}</span>
                        </a>
                      ) : (
                        <div className="truncate text-xs text-white/60">No page loaded</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="composer-send-hit-target h-8 w-8 shrink-0 p-0 text-white hover:bg-white/20 hover:text-white"
                      onClick={() => setIsFullscreen(true)}
                      disabled={!selectedSession?.screenshotDataUrl}
                      title="Full screen"
                      aria-label="Full screen"
                    >
                      <Expand className="h-4 w-4" />
                    </Button>
                    {/* Below lg with a chip row, every session carries its own
                        menu; otherwise the bar holds the selected one's. */}
                    <div className={cn('shrink-0', sessions.length > 1 && 'hidden lg:block')}>
                      <RowActionsTrigger
                        label={`Actions for ${selectedSession?.title || getDomain(selectedSession?.url || null)}`}
                        isOpen={actionMenu?.sessionId === selectedSession?.id}
                        onOpen={(anchor) => selectedSession && openSessionMenu(selectedSession, anchor)}
                        className="text-white/80 hover:bg-white/20 hover:text-white"
                      />
                    </div>
                  </div>

                  {renderCapture()}

                  {selectedSession && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/60">
                      <span className="inline-flex shrink-0 items-center gap-1">
                        {(() => {
                          const DeviceIcon = DEVICE_ICONS[selectedSession.device] || Monitor;
                          return <DeviceIcon className="h-3 w-3" />;
                        })()}
                        {selectedSession.viewport
                          ? `${selectedSession.viewport.width}×${selectedSession.viewport.height}`
                          : selectedSession.device}
                      </span>
                      <span className="truncate">{formatAction(selectedSession.lastAction)}</span>
                      <span className="ml-auto shrink-0">{formatRelativeTime(selectedSession.updatedAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border/60 bg-background lg:flex">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">Sessions</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{sessions.length} total</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{activeSessions.length} active</Badge>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sessions.length > 0 ? (
              <div className="space-y-2">{sessions.map(renderSessionItem)}</div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                No agent browser sessions.
              </div>
            )}
          </div>

          <div className="border-t border-border/60 p-3">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                Selected
              </div>
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>Last action</span>
                  <span className="truncate font-medium text-foreground">{formatAction(selectedSession?.lastAction || null)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Profile</span>
                  <span className="truncate font-medium text-foreground">{selectedSession?.profileName || 'Temporary'}</span>
                </div>
              </div>
              {selectedSession && selectedSession.actions.length > 0 && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent actions</div>
                  <ol className="mt-2 space-y-1">
                    {[...selectedSession.actions].reverse().slice(0, 8).map((action, index) => (
                      <li key={`${action.at}-${index}`} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className={cn('h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full', action.ok ? 'bg-primary' : 'bg-destructive')} />
                          <span className="truncate text-foreground">{formatToolName(action.tool)}</span>
                          <span className="sr-only">{action.ok ? 'succeeded' : 'failed'}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatClockTime(action.at)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
                  <CircleStop className="h-4 w-4" />
                  Stop
                </Button>
                <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setIsConfirmingDelete(true)} disabled={isBusy || !selectedSession}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {actionMenu && (
        <ContextMenuOverlay
          anchor={actionMenu.anchor}
          onDismiss={() => setActionMenu(null)}
          ariaLabel="Browser session actions"
          className="min-w-[200px] px-1 py-1"
        >
          {sessionMenuActions(menuSession).map((action) => (
            <Fragment key={action.key}>
              {action.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => { setActionMenu(null); action.onSelect(); }}
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
            </Fragment>
          ))}
        </ContextMenuOverlay>
      )}

      <Dialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete this browser session?</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {selectedSession?.title || getDomain(selectedSession?.url || null)} closes and its
            screenshot and action history are removed. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteSession} disabled={isBusy}>
              <Trash2 className="h-4 w-4" />
              Delete session
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isFullscreen && selectedSession && (
        <div className="safe-top fixed inset-0 z-50 bg-black/90 p-6">
          <div className="flex h-full flex-col rounded-md border border-white/10 bg-black">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-white/80">
              <div className="min-w-0 truncate">{selectedSession.title || selectedSession.url || 'Browser session'}</div>
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-neutral-950">
              {selectedSession.screenshotDataUrl ? (
                <img
                  src={selectedSession.screenshotDataUrl}
                  alt={`Latest capture of ${selectedSession.title || getDomain(selectedSession.url)}`}
                  className="block max-h-full w-auto max-w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-sm text-neutral-100">{selectedSession.message || 'Waiting for screenshot'}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
