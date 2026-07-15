import { ActivityIcon } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Denominator is the context window (`total`), which for Claude defaults to
// 160k — the effective budget before Claude Code auto-compacts, so a full wheel
// lines up with roughly when a compact fires. Green/amber/red is the signal;
// the raw count is just detail.
const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const toneFor = (fraction: number) => {
  if (fraction >= 0.9) return 'text-red-500';
  if (fraction >= 0.75) return 'text-amber-500';
  return 'text-emerald-500';
};

function UsageWheel({ fraction }: { fraction: number }) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <span className={`grid h-5 w-5 place-items-center ${toneFor(clamped)}`}>
      <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          className="stroke-current opacity-20"
        />
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-current transition-[stroke-dashoffset] duration-500"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  );
}

export default function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const contextWindow = readUsageNumber(usage?.total);
  const fraction = contextWindow > 0 ? usedTokens / contextWindow : null;

  const title =
    fraction === null
      ? `${usedTokens.toLocaleString()} tokens used`
      : `${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${Math.round(
          Math.min(fraction, 1) * 100,
        )}% of context window)`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label="Show token usage"
    >
      {fraction === null ? (
        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
          <ActivityIcon className="h-3.5 w-3.5" />
        </span>
      ) : (
        <UsageWheel fraction={fraction} />
      )}
      <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
      <span className="hidden text-muted-foreground/70 sm:inline">tokens</span>
    </button>
  );
}
