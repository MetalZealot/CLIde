import { Bot, Check, CircleSlash, Layers, Loader2, SquareTerminal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { BottomSheet, useCloseOnBack, useSheetAsPopover } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import { normalizedToChatMessages } from '../../hooks/useChatMessages';
import type { ChatMessage } from '../../types/types';
import type { BackgroundTaskInfo } from '../../../../stores/useSessionStore';
import { applyLiveTasks, listBackgroundWork, mergeBackgroundWork, type BackgroundWorkItem } from '../../utils/backgroundWork';
import { formatDuration } from '../../utils/chatFormatting';

import { useActivityLineSlot } from './ActivityLineSlot';
import { AgentViewer, ViewerFrame } from './SubagentActivity';

type BackgroundWorkProps = {
  sessionId: string | null;
  messages: ChatMessage[];
  /** The run is still open, so work reading running really is. */
  isLive: boolean;
  /** The provider's own list of live tasks, when it reports one. */
  liveTasks?: BackgroundTaskInfo[];
  isVisible: boolean;
  /** Absent when the provider cannot stop one task on its own. */
  onStop?: (taskId: string) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onRunningChange?: (running: BackgroundRunning | null) => void;
};

/** What the jump-to-bottom button shows of the work: how many run, and which icon. */
export type BackgroundRunning = { running: number; agentsOnly: boolean };

type BackgroundOutput = { output: string; truncated: boolean; live: boolean };

const OUTPUT_POLL_MS = 2000;
const NO_MESSAGES: ChatMessage[] = [];
const clearedKey = (sessionId: string) => `clide.backgroundCleared.${sessionId}`;

function readCleared(sessionId: string | null): Set<string> {
  if (!sessionId) return new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(clearedKey(sessionId)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Finished items the user cleared, kept per session across reloads. */
function useClearedWork(sessionId: string | null) {
  const [cleared, setCleared] = useState(() => readCleared(sessionId));
  useEffect(() => setCleared(readCleared(sessionId)), [sessionId]);
  const clear = useCallback((keys: string[]) => {
    if (!sessionId) return;
    setCleared((current) => {
      const next = new Set([...current, ...keys]);
      try {
        localStorage.setItem(clearedKey(sessionId), JSON.stringify([...next]));
      } catch {
        // Storage full or blocked: the clear holds for this page only.
      }
      return next;
    });
  }, [sessionId]);
  return { cleared, clear };
}

/**
 * The session's agent and command records from its whole history, so work
 * launched on a page not yet loaded is still listed. Read again whenever the
 * loaded work changes.
 */
function useStoredBackgroundWork(sessionId: string | null, signature: string): ChatMessage[] {
  const [stored, setStored] = useState<{ sessionId: string; messages: ChatMessage[] } | null>(null);
  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    // A status change can land a beat before its transcript row does.
    const timer = setTimeout(() => {
      authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/background`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!cancelled && Array.isArray(body?.data?.messages)) {
            setStored({ sessionId, messages: normalizedToChatMessages(body.data.messages) });
          }
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, signature]);
  return stored?.sessionId === sessionId ? stored.messages : NO_MESSAGES;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function elapsedSince(timestamp: ChatMessage['timestamp'], now: number): number | null {
  const started = Date.parse(String(timestamp ?? ''));
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

function StateIcon({ state }: { state: BackgroundWorkItem['state'] }) {
  if (state === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  if (state === 'completed') return <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
  if (state === 'failed') return <X className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
  return <CircleSlash className="h-3.5 w-3.5" aria-hidden="true" />;
}

function itemMeta(item: BackgroundWorkItem, now: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const running = item.state === 'running';
  const elapsed = running ? elapsedSince(item.message.timestamp, now) : item.durationMs;
  return [
    running ? '' : t(`backgroundWork.state.${item.state}`),
    item.launchedBy ? t('backgroundWork.launchedBy', { name: item.launchedBy }) : '',
    item.kind === 'agent' && item.callCount > 0 ? t('activity.agent.calls', { count: item.callCount }) : '',
    elapsed != null && elapsed >= 1000 ? formatDuration(elapsed) : '',
  ].filter(Boolean).join(' · ');
}

function WorkRow({ item, now, onOpen, onStop }: {
  item: BackgroundWorkItem;
  now: number;
  onOpen: (key: string) => void;
  onStop?: (taskId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [isStopping, setIsStopping] = useState(false);
  const Icon = item.kind === 'agent' ? Bot : SquareTerminal;
  const title = item.kind === 'agent' ? item.title || t('activity.agent.defaultType') : t('backgroundWork.command');
  const detail = item.kind === 'agent' ? item.description : item.title;
  const meta = itemMeta(item, now, t);
  // An agent known only from the live list has no transcript here to open.
  const isOpenable = !(item.liveOnly && item.kind === 'agent');
  return (
    <li className="flex items-center gap-2 border-b border-border/50 py-2 last:border-b-0">
      <button type="button" disabled={!isOpenable} onClick={() => onOpen(item.key)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate font-semibold text-foreground">{title}</span>
          {detail && <span className={`truncate text-muted-foreground ${item.kind === 'command' && !item.liveOnly ? 'font-mono text-[13px]' : ''}`}>{detail}</span>}
          <span className="flex items-center gap-1.5 text-chat-meta tabular-nums text-muted-foreground/80">
            <StateIcon state={item.state} />
            {meta}
          </span>
        </span>
      </button>
      {item.state === 'running' && onStop && item.taskId && (
        <button
          type="button"
          disabled={isStopping}
          onClick={() => {
            setIsStopping(true);
            onStop(item.taskId as string);
          }}
          className="h-8 shrink-0 rounded-md border border-border px-3 text-sm text-foreground disabled:opacity-60"
        >
          {isStopping ? t('activity.agent.stopping') : t('activity.agent.stop')}
        </button>
      )}
    </li>
  );
}

/** A background command: its command line and the end of its output, live while it runs. */
function CommandViewer({ item, sessionId, now, onBack, onStop }: {
  item: BackgroundWorkItem;
  sessionId: string | null;
  now: number;
  onBack: () => void;
  onStop?: (taskId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [output, setOutput] = useState<BackgroundOutput | null | undefined>(undefined);
  const isRunning = item.state === 'running';

  useEffect(() => {
    if (!sessionId || !item.taskId) {
      setOutput(null);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/background/${encodeURIComponent(item.taskId as string)}/output`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (cancelled) return;
          setOutput(body?.data?.output ?? null);
          if (isRunning) timer = setTimeout(read, OUTPUT_POLL_MS);
        })
        .catch(() => {
          if (!cancelled) setOutput((current) => current ?? null);
        });
    };
    read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, item.taskId, isRunning]);

  return (
    <ViewerFrame
      label={item.title}
      title={t('backgroundWork.command')}
      subtitle={(item.launchedBy ? t('backgroundWork.launchedBy', { name: item.launchedBy }) : item.description) || undefined}
      backLabel={t('backgroundWork.back')}
      onBack={onBack}
      embedded
      action={isRunning && onStop && item.taskId ? (
        <button type="button" onClick={() => onStop(item.taskId as string)} className="h-8 shrink-0 rounded-md border border-border px-3 text-sm">
          {t('activity.agent.stop')}
        </button>
      ) : undefined}
    >
      <div className="flex items-center gap-1.5 py-1 text-chat-meta tabular-nums text-muted-foreground">
        <StateIcon state={item.state} />
        {isRunning ? [t('backgroundWork.state.running'), itemMeta(item, now, t)].filter(Boolean).join(' · ') : itemMeta(item, now, t)}
      </div>
      <h3 className="mb-1 mt-3 text-chat-meta font-medium uppercase tracking-wide text-muted-foreground">{t('backgroundWork.command')}</h3>
      <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs leading-5">{item.liveOnly ? item.title : `$ ${item.title}`}</pre>
      <h3 className="mb-1 mt-4 text-chat-meta font-medium uppercase tracking-wide text-muted-foreground">
        {output?.live ? t('backgroundWork.outputLive') : t('backgroundWork.output')}
      </h3>
      {output === undefined && <p className="text-chat-meta text-muted-foreground" role="status">{t('backgroundWork.outputLoading')}</p>}
      {output === null && <p className="text-chat-meta text-muted-foreground">{t('backgroundWork.outputGone')}</p>}
      {output && (
        <>
          {output.truncated && <p className="mb-1 text-chat-meta text-muted-foreground">{t('backgroundWork.outputTruncated')}</p>}
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs leading-5">
            {output.output || t('backgroundWork.outputEmpty')}
          </pre>
        </>
      )}
    </ViewerFrame>
  );
}

/**
 * The session's agents and background commands, behind one mark at the right end of
 * the chat's last activity line: running ones with Stop, finished ones until cleared,
 * each opening full screen. No work, no mark.
 */
export default function BackgroundWork({ sessionId, messages, isLive, liveTasks, isVisible, onStop, onFileOpen, onRunningChange }: BackgroundWorkProps) {
  const { t } = useTranslation('chat');
  const slot = useActivityLineSlot();
  const [isOpen, setIsOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const asPopover = useSheetAsPopover();
  const markRef = useRef<HTMLButtonElement | null>(null);
  const { cleared, clear } = useClearedWork(sessionId);
  const loaded = useMemo(() => listBackgroundWork(messages, isLive), [messages, isLive]);
  const signature = `${isLive}|${loaded.map((item) => `${item.key}:${item.state}`).join(',')}`;
  const storedMessages = useStoredBackgroundWork(sessionId, signature);
  const items = useMemo(
    () => applyLiveTasks(mergeBackgroundWork(loaded, listBackgroundWork(storedMessages, isLive)), isLive ? liveTasks : undefined),
    [loaded, storedMessages, isLive, liveTasks],
  );
  const running = items.filter((item) => item.state === 'running');
  const done = items.filter((item) => item.state !== 'running' && !cleared.has(item.key)).reverse();
  const opened = openKey ? items.find((item) => item.key === openKey) ?? null : null;
  const now = useNow((isOpen || Boolean(opened)) && running.length > 0);

  const closeAll = useCallback(() => {
    setOpenKey(null);
    setIsOpen(false);
  }, []);
  // The sheet keeps its history entry under an opened item, so back returns to the list.
  useCloseOnBack(Boolean(opened), () => setOpenKey(null), { nested: true });
  useEffect(() => {
    setOpenKey(null);
    setIsOpen(false);
  }, [sessionId]);
  useEffect(() => {
    if (!isVisible) closeAll();
  }, [isVisible, closeAll]);

  const listed = [...running, ...done];
  const agentsOnly = listed.every((item) => item.kind === 'agent');
  const runningCount = isVisible && sessionId ? running.length : 0;
  useEffect(() => {
    onRunningChange?.(runningCount > 0 ? { running: runningCount, agentsOnly } : null);
  }, [onRunningChange, runningCount, agentsOnly]);

  if (!isVisible || !sessionId || listed.length === 0) return null;
  const title = agentsOnly ? t('backgroundWork.agentsTitle') : t('backgroundWork.title');
  const MarkIcon = agentsOnly ? Bot : Layers;

  const closeViewer = () => setOpenKey(null);
  const viewer = () => {
    if (opened?.kind === 'agent' && !opened.liveOnly) {
      return <AgentViewer message={opened.message} isLive={isLive} onFileOpen={onFileOpen} onClose={closeViewer} embedded />;
    }
    if (opened?.kind === 'command') {
      return <CommandViewer item={opened} sessionId={sessionId} now={now} onBack={closeViewer} onStop={onStop} />;
    }
    return null;
  };
  const listBody = (
    <>
      <h3 className="mb-1 mt-2 text-chat-meta font-medium uppercase tracking-wide text-muted-foreground">{t('backgroundWork.sectionRunning')}</h3>
      {running.length > 0 ? (
        <ul className="text-sm">
          {running.map((item) => <WorkRow key={item.key} item={item} now={now} onOpen={setOpenKey} onStop={onStop} />)}
        </ul>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">{t('backgroundWork.nothingRunning')}</p>
      )}
      {done.length > 0 && (
        <>
          <div className="mb-1 mt-5 flex items-center justify-between">
            <h3 className="text-chat-meta font-medium uppercase tracking-wide text-muted-foreground">{t('backgroundWork.sectionDone')}</h3>
            <button type="button" onClick={() => clear(done.map((item) => item.key))} className="py-1 pl-3 text-sm text-primary">
              {t('backgroundWork.clear')}
            </button>
          </div>
          <ul className="text-sm">
            {done.map((item) => <WorkRow key={item.key} item={item} now={now} onOpen={setOpenKey} />)}
          </ul>
        </>
      )}
    </>
  );

  return (
    <>
      {slot && createPortal(
        // An icon and a count: a label here would truncate the Working text on a phone. Line height, so the row never grows.
        <button
          ref={markRef}
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={running.length
            ? t(agentsOnly ? 'backgroundWork.openAgents' : 'backgroundWork.open', { count: running.length })
            : title}
          className={`flex h-6 shrink-0 items-center gap-1 rounded-full pl-2 pr-2.5 text-[13px] font-semibold tabular-nums active:brightness-90 ${running.length ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
        >
          <MarkIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {running.length > 0
            ? (
              <>
                <span>{running.length}</span>
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.5} aria-hidden="true" />
              </>
            )
            : <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />}
        </button>,
        slot,
      )}

      {/* An opened item replaces the list inside it; on a phone the sheet grows to full height for it. */}
      <BottomSheet
        open={isOpen}
        onClose={closeAll}
        title={title}
        anchor={() => markRef.current}
        popoverClassName={opened && asPopover ? 'h-[70vh] w-[44rem]' : 'w-[26rem]'}
        expandable={Boolean(opened)}
        expanded
      >
        {opened ? viewer() : (
          <>
            <h2 className="shrink-0 px-4 pb-1 pt-2 text-base font-semibold">{title}</h2>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{listBody}</div>
          </>
        )}
      </BottomSheet>

    </>
  );
}
