import { useTranslation } from 'react-i18next';

import { formatDuration } from '../../utils/chatFormatting';
import type { TurnSummary } from '../../utils/turnDuration';

/** A finished turn's time and output tokens, set like the activity row it replaces. */
export default function TurnSummaryRow({ summary }: { summary: TurnSummary }) {
  const { t } = useTranslation('chat');
  const metrics = [
    summary.durationMs !== undefined ? formatDuration(summary.durationMs) : '',
    summary.outputTokens !== undefined
      ? t('claudeStatus.outputTokens', {
        count: summary.outputTokens,
        tokens: summary.outputTokens.toLocaleString(),
        defaultValue: '{{tokens}} tokens',
      })
      : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="mt-1 flex min-h-6 min-w-0 select-none items-center gap-2 text-chat-activity text-muted-foreground sm:min-h-7">
      {/* The activity dots' settled ending, in the dots' own slot so the text lines up. */}
      <span className="relative inline-block h-[1em] w-[1em] shrink-0 text-[18px] opacity-60" aria-hidden>
        <i className="absolute left-1/2 top-1/2 -ml-[0.15em] -mt-[0.15em] h-[0.3em] w-[0.3em] rounded-full bg-current" />
      </span>
      <span className="whitespace-nowrap tabular-nums">{metrics}</span>
    </div>
  );
}
