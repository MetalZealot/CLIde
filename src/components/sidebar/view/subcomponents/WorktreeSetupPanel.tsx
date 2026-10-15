import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { formatPlaybackTime } from '../../../../lib/voicePlayer';
import { api } from '../../../../utils/api';
import type { WorktreeSetupView } from '../../types/types';

const POLL_INTERVAL_MS = 1000;

type WorktreeSetupPanelProps = {
  branch: string;
  initialSetup: WorktreeSetupView;
  /** Null when the worktree could not be registered; there is nothing to open. */
  canOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  t: TFunction;
};

/**
 * The new worktree's setup, streamed in the create modal. Open stays disabled
 * until it succeeds, because an agent working in a copy without its
 * dependencies fails in ways that look like code bugs.
 */
export default function WorktreeSetupPanel({
  branch,
  initialSetup,
  canOpen,
  onOpen,
  onClose,
  t,
}: WorktreeSetupPanelProps) {
  const [setup, setSetup] = useState(initialSetup);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const isActive = setup.status === 'queued' || setup.status === 'running';

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.worktreeSetup(setup.worktreePath);
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          setPollError(t(
            'worktrees.setup.lost',
            'CLIde restarted and lost track of this setup. Run the setup command in the worktree by hand.',
          ));
          setSetup((current) => ({ ...current, status: 'failed' }));
          return;
        }
        if (response.ok) {
          const payload = (await response.json()) as { data?: WorktreeSetupView };
          if (!cancelled && payload.data) {
            setSetup(payload.data);
            setPollError(null);
          }
        }
      } catch {
        // A dropped connection on the phone; the next tick picks the job back up.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isActive, setup.worktreePath, t]);

  useEffect(() => {
    if (setup.status === 'succeeded' && canOpen) {
      onOpenRef.current();
    }
  }, [setup.status, canOpen]);

  useEffect(() => {
    const element = outputRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [setup.output]);

  const retry = async () => {
    setIsRetrying(true);
    try {
      const response = await api.retryWorktreeSetup(setup.worktreePath);
      const payload = (await response.json().catch(() => ({}))) as { data?: WorktreeSetupView };
      if (response.ok && payload.data) {
        setSetup(payload.data);
        setPollError(null);
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const elapsed = formatPlaybackTime(setup.elapsedMs / 1000);
  const heading = setup.status === 'queued'
    ? t('worktrees.setup.queued', {
        count: setup.queuePosition,
        defaultValue: 'Waiting for another setup to finish · {{count}} ahead',
      })
    : setup.status === 'failed'
      ? t('worktrees.setup.failed', {
          code: setup.exitCode ?? '—',
          defaultValue: 'Setup failed (exit {{code}})',
        })
      : setup.status === 'succeeded'
        ? t('worktrees.setup.succeeded', 'Set up')
        : t('worktrees.setup.running', { branch, defaultValue: 'Setting up {{branch}}' });

  return (
    <div className="space-y-2 border-t border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm">
        {isActive && <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />}
        {setup.status === 'failed' && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-600 dark:text-red-400" />}
        <span
          className={
            setup.status === 'failed'
              ? 'min-w-0 flex-1 truncate font-medium text-red-700 dark:text-red-300'
              : 'min-w-0 flex-1 truncate font-medium text-foreground'
          }
        >
          {heading}
        </span>
        {setup.status !== 'queued' && (
          <span className="flex-shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</span>
        )}
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{setup.command}</p>
      {setup.output && (
        <pre
          ref={outputRef}
          className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground"
        >
          {setup.output}
        </pre>
      )}
      {pollError && <p className="text-xs text-red-600 dark:text-red-400">{pollError}</p>}
      <div className="flex gap-2">
        {setup.status === 'failed' ? (
          <>
            {!pollError && (
              <Button size="sm" className="flex-1" disabled={isRetrying} onClick={() => void retry()}>
                {isRetrying ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCw className="mr-2 h-3.5 w-3.5" />
                )}
                {t('worktrees.setup.retry', 'Retry')}
              </Button>
            )}
            {canOpen && (
              <Button variant="ghost" size="sm" onClick={onOpen}>
                {t('worktrees.setup.openAnyway', 'Open anyway')}
              </Button>
            )}
          </>
        ) : isActive && (
          <Button size="sm" className="flex-1" disabled>
            {t('worktrees.setup.openWhenReady', 'Opens when setup finishes')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('actions.close', 'Close')}
        </Button>
      </div>
    </div>
  );
}
