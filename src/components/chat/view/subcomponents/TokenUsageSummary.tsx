import { ActivityIcon } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
  provider?: string;
};

// A fresh session has no `token_budget` frame yet, so `usage` is null until the
// first turn. For providers with a known context window we still want the ring
// to render (empty, at 0%) from the start instead of the legacy activity icon.
// Providers that never report a window (cursor/opencode) fall through to null
// and keep the icon fallback. Claude's placeholder matches what the server
// derives for an unknown model; once the first real frame arrives its `total`
// takes over, and that value now comes from the SDK itself.
const PROVIDER_DEFAULT_CONTEXT_WINDOW: Record<string, number> = {
  claude: 200_000,
  codex: 200_000,
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

// The wheel fills and colours against the same number: the point where the
// session stops being able to grow. That is `autoCompactThreshold` when
// auto-compact is on (Claude reports e.g. a 967k window that compacts at 934k —
// the last 33k is never usable conversation), and the window itself otherwise.
// Filling against the window instead left the wheel looking calm at the exact
// moment a compact fired. Green/amber/red is the signal; the count is detail.
const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const toneFor = (fraction: number) => {
  if (fraction >= 0.9) return 'text-red-500';
  if (fraction >= 0.75) return 'text-amber-500';
  return 'text-emerald-500';
};

function UsageWheel({ fraction, tone }: { fraction: number; tone: string }) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <span className={`grid h-5 w-5 place-items-center ${tone}`}>
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

export default function TokenUsageSummary({ usage, onClick, provider }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const reportedWindow = readUsageNumber(usage?.total);
  const contextWindow =
    reportedWindow > 0
      ? reportedWindow
      : (provider ? PROVIDER_DEFAULT_CONTEXT_WINDOW[provider] ?? 0 : 0);
  const autoCompactThreshold = readUsageNumber(usage?.autoCompactThreshold);
  const compactsAutomatically = usage?.isAutoCompactEnabled === true && autoCompactThreshold > 0;

  // The ceiling that actually matters is where auto-compact fires, not the raw
  // window: at that point the conversation is summarised out from under the
  // user, so the tokens above it were never theirs to spend. Claude Code counts
  // the same way — its /context "Free space" is measured to the threshold, with
  // the remainder carved out as an "Autocompact buffer" slice. With auto-compact
  // off (or a provider that reports no threshold) the window IS the cliff, so it
  // stands as the ceiling.
  const effectiveCeiling = compactsAutomatically ? autoCompactThreshold : contextWindow;
  const fraction = effectiveCeiling > 0 ? usedTokens / effectiveCeiling : null;

  const title =
    fraction === null
      ? `${usedTokens.toLocaleString()} tokens used`
      : compactsAutomatically
        ? `${usedTokens.toLocaleString()} / ${autoCompactThreshold.toLocaleString()} tokens before auto-compact (${Math.round(
            Math.min(fraction, 1) * 100,
          )}%)\nAuto-compact rewrites the conversation here. Window: ${contextWindow.toLocaleString()}.`
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
        <UsageWheel fraction={fraction} tone={toneFor(Math.min(Math.max(fraction, 0), 1))} />
      )}
      <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
      <span className="hidden text-muted-foreground/70 sm:inline">tokens</span>
    </button>
  );
}
