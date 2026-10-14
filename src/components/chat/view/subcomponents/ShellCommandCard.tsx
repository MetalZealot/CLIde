import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, Square } from 'lucide-react';

import { useOptionalWebSocket } from '../../../../contexts/WebSocketContext';
import { useUiPreference } from '../../../../hooks/useUiPreferences';
import { retrySend, useOutboxEntry } from '../../../../stores/sendOutbox';
import type { ShellCommandInfo } from '../../../../stores/useSessionStore';
import { formatDuration } from '../../utils/chatFormatting';

import { DetailPanel } from './DetailPanel';

/** Ticks once a second while the command runs, from the row's own start time. */
function useElapsed(startedAt: string | number | Date, running: boolean): number {
  const start = new Date(startedAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}

/** A command run with the composer's `!` mode: the command, how it ended, and its output folded under it. */
export default function ShellCommandCard({ shell, timestamp, sessionId, pendingRequestId }: {
  shell: ShellCommandInfo;
  timestamp: string | number | Date;
  sessionId?: string;
  /** Set while this is the composer's own copy, before the server has the command. */
  pendingRequestId?: string | null;
}) {
  const { t } = useTranslation('chat');
  const socket = useOptionalWebSocket();
  const sendEntry = useOutboxEntry(pendingRequestId ?? null);
  const isPending = Boolean(pendingRequestId);
  const notSent = sendEntry?.stage === 'failed';
  const running = shell.state === 'running' && !notSent;
  // Open while it runs or when it failed; a passing command folds away, live or on reload.
  const [isOpen, setIsOpen] = useState(shell.state !== 'done');
  const previousState = useRef(shell.state);
  useEffect(() => {
    if (previousState.current === 'running' && shell.state === 'done') setIsOpen(false);
    previousState.current = shell.state;
  }, [shell.state]);
  // Long output scrolls inside the card, from its end, where errors and results land.
  const outputRef = useRef<HTMLDivElement>(null);
  // The toggle inverts the tool-output setting for this card only, as a tool call's panel does.
  const wrapSetting = useUiPreference('wrapToolOutput');
  const [wrapFlipped, setWrapFlipped] = useState(false);
  const wrap = wrapSetting !== wrapFlipped;
  const elapsed = useElapsed(timestamp, running);
  const duration = formatDuration(running ? elapsed : shell.durationMs ?? 0);
  // Under a second reads as "0s", so a quick command shows its exit alone.
  const hasDuration = running || (shell.durationMs ?? 0) >= 1000;
  const isFailure = notSent || shell.state === 'failed' || shell.state === 'timed_out';

  const status = notSent
    ? t('shellMode.notSent')
    : isPending
      ? t('shellMode.starting')
      : running
        ? t('shellMode.running', { duration })
        : shell.state === 'stopped'
          ? t('shellMode.stopped', { duration })
          : shell.state === 'timed_out'
            ? t('shellMode.timedOut', { duration })
            : hasDuration
              ? t('shellMode.exitWithDuration', { code: shell.exitCode ?? '?', duration })
              : t('shellMode.exit', { code: shell.exitCode ?? '?' });

  const output = shell.output.replace(/\s+$/, '');
  useEffect(() => {
    const box = outputRef.current;
    if (isOpen && box) box.scrollTop = box.scrollHeight;
  }, [isOpen, output]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60" data-chat-find-content>
      <div className="flex min-h-10 items-center gap-2 pr-3 text-chat-activity">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex min-h-10 min-w-0 flex-1 select-none items-center gap-2 pl-3 text-left"
        >
          <span className="shrink-0 font-mono font-semibold text-pink-500">!</span>
          <span className="min-w-0 flex-1 truncate font-mono text-foreground">{shell.command}</span>
          <span className={`flex shrink-0 items-center gap-1.5 text-chat-meta tabular-nums ${isFailure ? 'text-destructive' : 'text-muted-foreground'}`}>
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {status}
          </span>
        </button>
        {notSent && pendingRequestId && (
          <button
            type="button"
            onClick={() => retrySend(pendingRequestId)}
            className="shrink-0 rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-chat-meta text-foreground"
          >
            {t('shellMode.retry')}
          </button>
        )}
        {running && !isPending && sessionId && socket && (
          <button
            type="button"
            onClick={() => socket.sendMessage({ type: 'chat.abort', sessionId })}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-chat-meta text-foreground"
          >
            <Square className="h-3 w-3" aria-hidden /> {t('shellMode.stop')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-label={isOpen ? t('shellMode.hideOutput') : t('shellMode.showOutput')}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {isOpen && (
        <div className="px-3 pb-2">
          <DetailPanel
            copyText={output || undefined}
            wrap={output ? { on: wrap, toggle: () => setWrapFlipped((flipped) => !flipped) } : undefined}
            scrolls={Boolean(output)}
          >
            {output
              ? (
                // Bleeds to the panel's sides so the scrollbar sits on its edge.
                <div ref={outputRef} className="-mx-2.5 max-h-72 max-w-none overflow-auto overscroll-contain px-2.5">
                  <pre className={`font-mono text-xs leading-5 ${wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'w-max min-w-full max-w-none whitespace-pre'}`}>{output}</pre>
                </div>
              )
              : <p className="text-chat-meta text-muted-foreground">{running ? t('shellMode.waitingForOutput') : t('shellMode.noOutput')}</p>}
            {shell.truncated && (
              <p className="mt-1 text-chat-meta text-muted-foreground">
                {shell.fullOutputPath
                  ? t('shellMode.truncatedWithPath', { path: shell.fullOutputPath })
                  : t('shellMode.truncated')}
              </p>
            )}
          </DetailPanel>
        </div>
      )}
    </div>
  );
}
