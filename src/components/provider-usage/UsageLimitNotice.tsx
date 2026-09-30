import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ComposerNotice } from '../../shared/view/ui';
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
    <ComposerNotice
      onDismiss={dismiss}
      dismissLabel={t('planUsage.dismissWarning', { defaultValue: 'Dismiss' })}
    >
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
    </ComposerNotice>
  );
}
