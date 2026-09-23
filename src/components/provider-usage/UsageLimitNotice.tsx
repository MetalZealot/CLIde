import { XIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '../../types/app';
import { formatClockTimeWithDay } from '../../utils/formatTime';

import { formatUsageWindowLabel, pickUsageWarning } from './format';
import { useProviderUsage } from './hooks/useProviderUsage';

const DISMISSED_STORAGE_KEY = 'usage-warning-dismissed';

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

/** One dismissible line above the composer once a plan usage window reaches the warning line. */
export default function UsageLimitNotice({ provider }: { provider: LLMProvider }) {
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

  const label = formatUsageWindowLabel(warning.window, t);
  const percent = Math.round(warning.window.utilization);
  const resets = warning.window.resetsAt ? formatClockTimeWithDay(warning.window.resetsAt) : '';

  return (
    <div className="mx-auto mb-2 max-w-[54.25rem]" role="status">
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs leading-4 text-muted-foreground">
        <span className="min-w-0 flex-1">
          {resets
            ? t('planUsage.warning', {
              defaultValue: '{{window}}: {{percent}}% used · resets {{time}}',
              window: label,
              percent,
              time: resets,
            })
            : t('planUsage.warningNoReset', {
              defaultValue: '{{window}}: {{percent}}% used',
              window: label,
              percent,
            })}
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('planUsage.dismissWarning', { defaultValue: 'Dismiss' })}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
