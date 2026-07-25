import { Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '../../types/app';

import { useProviderUsage } from './hooks/useProviderUsage';

type OnCreditsBadgeProps = {
  provider?: string;
};

/**
 * Compact "On credits" pill shown beside the composer token ring when the
 * provider's plan limit is spent and paid usage-credits are actively covering
 * the session. Renders nothing otherwise — including for providers with no
 * credit concept (usage stays `supported: false`, so `credits` is absent) and
 * while a plan window still has headroom. The plan-usage fetch is shared with
 * the Token Usage modal / Settings via the hook's module cache, so this doesn't
 * add its own polling.
 */
export default function OnCreditsBadge({ provider }: OnCreditsBadgeProps) {
  const usageProvider: LLMProvider | null = (
    provider === 'claude'
    || provider === 'cursor'
    || provider === 'codex'
    || provider === 'opencode'
  ) ? provider : null;
  const { usage } = useProviderUsage(usageProvider);
  const { t } = useTranslation('common');

  const credits = usage?.credits;
  const planLimitReached = usage?.windows?.some((window) => window.utilization >= 100) ?? false;
  const creditsAvailable = credits?.kind === 'spend'
    ? credits.enabled
    : Boolean(
        credits
        && (credits.hasCredits || credits.unlimited)
        && !credits.limitReachedReason?.includes('depleted')
        && !credits.limitReachedReason?.includes('usage_limit_reached'),
      );
  if (!creditsAvailable || !planLimitReached || !credits) {
    return null;
  }

  const title = credits.kind === 'spend'
    ? t('planUsage.onCreditsTitle', {
        defaultValue:
          'Plan limit reached — usage credits are covering this session ({{pct}}% of credit cap used).',
        pct: Math.round(credits.utilization),
      })
    : t('planUsage.onBalanceCreditsTitle', {
        defaultValue: 'Plan limit reached — usage credits are covering this session.',
      });

  return (
    <span
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 text-xs font-medium text-amber-600 shadow-sm dark:text-amber-400"
      title={title}
    >
      <Coins className="h-3.5 w-3.5" />
      <span>{t('planUsage.onCredits', { defaultValue: 'On credits' })}</span>
    </span>
  );
}
