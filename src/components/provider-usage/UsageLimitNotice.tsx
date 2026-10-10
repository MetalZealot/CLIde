import { XIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ComposerNotice } from '../../shared/view/ui';
import type { LLMProvider } from '../../types/app';
import { formatClockTimeWithDay } from '../../utils/formatTime';

import { formatUsageWindowLabel, pickUsageWarning } from './format';
import { useProviderUsage } from './hooks/useProviderUsage';

const DISMISSED_STORAGE_KEY = 'usage-warning-dismissed';
const CALLOUT_GAP = 6;
const CALLOUT_EDGE = 8;

/** Dismissed warning key -> the reset it holds until, so a dismissal lapses with its window. */
const readDismissed = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
};

const writeDismissed = (key: string, untilMs: number) => {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(readDismissed()).filter(([, until]) => until > now));
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify({ ...kept, [key]: untilMs }));
  } catch {
    // Storage full or blocked: the dismissal still holds for this page.
  }
};

/** The plan window past the warning line, formatted, with a dismissal that lapses at its reset. */
function useUsageWarning(provider: LLMProvider) {
  const { t } = useTranslation('common');
  const { usage } = useProviderUsage(provider);
  const [dismissed, setDismissed] = useState(readDismissed);

  const warning = useMemo(
    () => pickUsageWarning(provider, usage?.windows, (key) => key in dismissed),
    [dismissed, provider, usage?.windows],
  );

  const dismiss = useCallback(() => {
    if (!warning) return;
    const resetMs = warning.window.resetsAt ? Date.parse(warning.window.resetsAt) : NaN;
    // No reset time: hold for a week, the longest window any provider reports.
    const untilMs = Number.isFinite(resetMs) ? resetMs : Date.now() + 7 * 24 * 60 * 60 * 1000;
    writeDismissed(warning.key, untilMs);
    setDismissed((previous) => ({ ...previous, [warning.key]: untilMs }));
  }, [warning]);

  if (!warning) return null;
  return {
    label: formatUsageWindowLabel(warning.window, t),
    percent: Math.round(warning.window.utilization),
    resets: warning.window.resetsAt ? formatClockTimeWithDay(warning.window.resetsAt) : '',
    dismiss,
    dismissLabel: t('planUsage.dismissWarning', { defaultValue: 'Dismiss' }),
  };
}

/** One dismissible line above the composer, used where the ring has no header to sit in. */
export default function UsageLimitNotice({ provider }: { provider: LLMProvider }) {
  const { t } = useTranslation('common');
  const warning = useUsageWarning(provider);
  if (!warning) return null;

  return (
    <ComposerNotice onDismiss={warning.dismiss} dismissLabel={warning.dismissLabel}>
      {warning.resets
        ? t('planUsage.warning', {
          defaultValue: '{{window}}: {{percent}}% used · resets {{time}}',
          window: warning.label,
          percent: warning.percent,
          time: warning.resets,
        })
        : t('planUsage.warningNoReset', {
          defaultValue: '{{window}}: {{percent}}% used',
          window: warning.label,
          percent: warning.percent,
        })}
    </ComposerNotice>
  );
}

type CalloutPosition = { top: number; right: number; caretRight: number };

/** Callout hung under the header ring, right-aligned to the app bar, its caret on the ring. */
const measureCallout = (anchor: HTMLElement): CalloutPosition | null => {
  const ring = anchor.getBoundingClientRect();
  if (ring.height <= 0) return null;
  const barRight = anchor.closest('.app-bar')?.getBoundingClientRect().right ?? window.innerWidth;
  const edge = Math.min(barRight, window.innerWidth) - CALLOUT_EDGE;
  return {
    top: ring.bottom + CALLOUT_GAP,
    right: window.innerWidth - edge,
    caretRight: edge - (ring.left + ring.width / 2),
  };
};

/**
 * The header form of the warning: stays until dismissed or the window resets.
 * Tapping the text opens the ring's panel; the callout stands aside while it is open.
 */
export function UsageLimitCallout({
  provider,
  anchor,
  hidden,
  onOpen,
}: {
  provider: LLMProvider;
  anchor: HTMLElement | null;
  hidden: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation('common');
  const warning = useUsageWarning(provider);
  const [position, setPosition] = useState<CalloutPosition | null>(null);
  const showing = Boolean(warning && anchor && !hidden);

  useLayoutEffect(() => {
    if (!showing || !anchor) return;
    const remeasure = () => setPosition(measureCallout(anchor));
    remeasure();
    const bar = anchor.closest('.app-bar');
    const observer = bar ? new ResizeObserver(remeasure) : null;
    if (bar) observer?.observe(bar);
    window.addEventListener('resize', remeasure);
    window.visualViewport?.addEventListener('resize', remeasure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', remeasure);
      window.visualViewport?.removeEventListener('resize', remeasure);
    };
  }, [anchor, showing]);

  if (!warning || !showing || !position) return null;

  return createPortal(
    <div
      role="status"
      className="animate-in fade-in-0 zoom-in-95 fixed z-40 flex max-w-[min(18rem,calc(100vw-1rem))] items-center gap-1.5 rounded-xl border border-border bg-popover py-1 pl-3 pr-1 text-popover-foreground shadow-lg"
      style={{ top: position.top, right: position.right }}
    >
      <span
        aria-hidden
        className="absolute -top-[5px] h-2.5 w-2.5 rotate-45 border-l border-t border-border bg-popover"
        style={{ right: Math.max(8, position.caretRight - 5) }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block text-[13px] leading-tight [overflow-wrap:anywhere]">
          {warning.label}{' '}
          <span className="font-semibold text-red-600 dark:text-red-400">
            {t('planUsage.calloutPercent', { defaultValue: '{{percent}}% used', percent: warning.percent })}
          </span>
        </span>
        {warning.resets && (
          <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">
            {t('planUsage.calloutResets', { defaultValue: 'Resets {{time}}', time: warning.resets })}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={warning.dismiss}
        aria-label={warning.dismissLabel}
        title={warning.dismissLabel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
