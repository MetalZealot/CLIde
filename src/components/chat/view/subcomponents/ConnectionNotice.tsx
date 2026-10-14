import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RotateCw, ServerOff, WifiOff } from 'lucide-react';

import { useWebSocket, type OutageCause } from '../../../../contexts/WebSocketContext';
import { cn } from '../../../../lib/utils';

/** Drops that heal sooner than this never show. */
const SHOW_AFTER_MS = 2_000;
const BACK_SHOWN_MS = 1_500;

export type ConnectionNoticeState = { kind: OutageCause; downSeconds: number } | { kind: 'back' };

/**
 * What the connection notice shows now: the outage once it has lasted
 * SHOW_AFTER_MS, then "Reconnected" briefly — only after an outage that showed.
 */
export function useConnectionNotice(): ConnectionNoticeState | null {
  const { outage } = useWebSocket();
  const [now, setNow] = useState(() => Date.now());
  const [backUntil, setBackUntil] = useState<number | null>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!outage) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [outage]);

  const visible = outage !== null && now - outage.since >= SHOW_AFTER_MS;

  useEffect(() => {
    if (visible) shownRef.current = true;
  }, [visible]);

  useEffect(() => {
    if (outage || !shownRef.current) return;
    shownRef.current = false;
    setBackUntil(Date.now() + BACK_SHOWN_MS);
  }, [outage]);

  useEffect(() => {
    if (backUntil === null) return undefined;
    const id = window.setTimeout(() => setBackUntil(null), Math.max(0, backUntil - Date.now()));
    return () => window.clearTimeout(id);
  }, [backUntil]);

  if (visible) return { kind: outage.cause, downSeconds: Math.floor((now - outage.since) / 1000) };
  if (!outage && backUntil !== null) return { kind: 'back' };
  return null;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const ICONS = { unreachable: ServerOff, restart: RotateCw, offline: WifiOff, back: Check } as const;

/** Grey for outages that heal themselves; red only when CLIde stays unreachable. */
export default function ConnectionNotice({ notice }: { notice: ConnectionNoticeState }) {
  const { t } = useTranslation();
  const alert = notice.kind === 'unreachable';
  const Icon = notice.kind === 'quiet' ? null : ICONS[notice.kind];

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm',
        alert ? 'border-red-500/50 text-red-600 dark:text-red-400' : 'border-border text-muted-foreground',
      )}
    >
      {Icon ? (
        <Icon className={cn('h-3.5 w-3.5 shrink-0', notice.kind === 'restart' && 'motion-safe:animate-spin')} aria-hidden />
      ) : (
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      <span className="truncate">{t(`connection.${notice.kind}`)}</span>
      {notice.kind !== 'back' && (
        <span className="shrink-0 tabular-nums opacity-75">· {formatDuration(notice.downSeconds)}</span>
      )}
    </div>
  );
}
