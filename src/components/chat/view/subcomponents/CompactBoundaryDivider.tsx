import { useTranslation } from 'react-i18next';

import type { CompactBoundaryInfo } from '../../../../stores/useSessionStore';
import { formatTokenCount } from '../../utils/chatFormatting';

/**
 * Marks where a compaction cut the conversation.
 *
 * A boundary is the one transcript event with no author: everything above it
 * is gone from the model's context and only the summary below survives. It
 * reads as a rule across the thread rather than a message, and carries the
 * numbers because "how much did that cost me" is the question it raises.
 */

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function CompactBoundaryDivider({ boundary }: { boundary?: CompactBoundaryInfo }) {
  const { t } = useTranslation('chat');

  const parts: string[] = [
    boundary?.trigger === 'manual'
      ? t('compactBoundary.manual', { defaultValue: 'Context compacted' })
      : t('compactBoundary.auto', { defaultValue: 'Context auto-compacted' }),
  ];

  if (boundary?.preTokens && boundary.postTokens) {
    parts.push(`${formatTokenCount(boundary.preTokens)} → ${formatTokenCount(boundary.postTokens)}`);
  }
  if (boundary?.durationMs) {
    parts.push(formatDuration(boundary.durationMs));
  }

  return (
    <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground/70">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="shrink-0 tabular-nums">{parts.join(' · ')}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
