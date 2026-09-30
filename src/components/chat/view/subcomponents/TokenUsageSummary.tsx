import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityIcon, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { LLMProvider } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import { HEADER_MENU_CLASS_NAME } from '../../../main-content/constants/menu';
import { useProviderUsage } from '../../../provider-usage/hooks/useProviderUsage';
import { UsageActivitySection } from '../../../provider-usage/UsageWindowList';
import { formatResetsIn } from '../../../provider-usage/format';
import {
  type ProviderUsageBalanceCredits,
  type ProviderUsageCredits,
  type ProviderUsageSpendCredits,
  type ProviderUsageWindow,
} from '../../../provider-usage/types';
import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import { authenticatedFetch } from '../../../../utils/api';
import { agentScreenId } from '../../../settings/registry/registry';
import { useComposerMenuAnchor, type ComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { formatCompactTokens, formatTokenCount } from '../../utils/chatFormatting';
import type {
  ContextCommandData,
  UsagePopoverRequest,
  UsagePopoverView,
} from '../../hooks/useChatComposerState';

import { ComposerMenuSurface } from './ComposerMenuPrimitives';
import ContextBreakdownView from './ContextBreakdownView';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  request: UsagePopoverRequest;
  onRequestBreakdown: () => void;
  onRefreshBreakdown: () => void;
  isRefreshingBreakdown: boolean;
  canRefreshBreakdown: boolean;
  provider?: string;
  /** Model the next turn would run, used to derive a ceiling before one exists. */
  model?: string;
  /** Conversation the composer is on; changing it invalidates the breakdown. */
  sessionKey?: string | null;
  /** In the app bar beside the header menu: match its button and its popover. */
  inHeader?: boolean;
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

type PromptCache = { ttlSeconds: number; refreshedAt: string };

const readPromptCache = (value: unknown): PromptCache | null => {
  if (!value || typeof value !== 'object') return null;
  const { ttlSeconds, refreshedAt } = value as Record<string, unknown>;
  return typeof ttlSeconds === 'number' && typeof refreshedAt === 'string' && Number.isFinite(Date.parse(refreshedAt))
    ? { ttlSeconds, refreshedAt }
    : null;
};

const formatUpdatedAge = (fetchedAt: string | undefined, now: number, t: TFunction): string | null => {
  const at = fetchedAt ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t('usagePopover.updatedJustNow', { defaultValue: 'Updated just now' });
  if (minutes < 60) return t('usagePopover.updatedMinutesAgo', { defaultValue: 'Updated {{count}} min ago', count: minutes });
  return t('usagePopover.updatedHoursAgo', { defaultValue: 'Updated {{count}} h ago', count: Math.floor(minutes / 60) });
};

// Deliberately shorter than the usage dashboard's wording: this row shares one
// line with the reset time and percentage.
const KNOWN_WINDOW_LABELS: Record<string, { key: string; defaultValue: string }> = {
  five_hour: { key: 'usagePopover.windowFiveHour', defaultValue: '5-hour limit' },
  seven_day: { key: 'usagePopover.windowWeekly', defaultValue: 'Weekly' },
  seven_day_opus: { key: 'usagePopover.windowWeeklyOpus', defaultValue: 'Weekly (Opus)' },
  seven_day_sonnet: { key: 'usagePopover.windowWeeklySonnet', defaultValue: 'Weekly (Sonnet)' },
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toUsageProvider = (provider: string | undefined): LLMProvider | null => (
  provider === 'claude' || provider === 'cursor' || provider === 'codex' || provider === 'opencode'
    ? provider
    : null
);

const formatWindowLabel = (window: ProviderUsageWindow, t: TFunction): string => {
  const durationLabel = window.durationMinutes === 300
    ? t('usagePopover.windowFiveHour', { defaultValue: '5-hour limit' })
    : window.durationMinutes === 10_080
      ? t('usagePopover.windowWeekly', { defaultValue: 'Weekly' })
      : window.durationMinutes
        ? window.durationMinutes % 1440 === 0
          ? t('usagePopover.windowDayLimit', {
              defaultValue: '{{count}}-day limit',
              count: window.durationMinutes / 1440,
            })
          : window.durationMinutes % 60 === 0
            ? t('usagePopover.windowHourLimit', {
                defaultValue: '{{count}}-hour limit',
                count: window.durationMinutes / 60,
              })
            : t('usagePopover.windowMinuteLimit', {
                defaultValue: '{{count}}-minute limit',
                count: window.durationMinutes,
              })
        : null;
  const known = KNOWN_WINDOW_LABELS[window.id];
  const baseLabel = (known ? t(known.key, { defaultValue: known.defaultValue }) : null)
    ?? durationLabel
    ?? window.id.replace(/[:_]/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
  return window.label ? `${window.label} · ${baseLabel}` : baseLabel;
};

const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const formatSpendCredits = (credits: ProviderUsageSpendCredits): string => (
  formatMoney(credits.usedAmount, credits.currency)
);

const formatBalanceCredits = (credits: ProviderUsageBalanceCredits, t: TFunction): string => {
  if (credits.unlimited) return t('planUsage.unlimited', { defaultValue: 'Unlimited' });
  if (credits.balance) return credits.balance;
  return credits.hasCredits
    ? t('planUsage.available', { defaultValue: 'Available' })
    : t('planUsage.none', { defaultValue: 'None' });
};

const formatCreditValue = (credits: ProviderUsageCredits, t: TFunction): string => (
  credits.kind === 'spend' ? formatSpendCredits(credits) : formatBalanceCredits(credits, t)
);

const creditsAreAvailable = (credits: ProviderUsageCredits | undefined): boolean => {
  if (!credits) return false;
  if (credits.kind === 'spend') {
    return credits.enabled && credits.usedAmount < credits.limitAmount;
  }
  return credits.unlimited || Boolean(
    credits.hasCredits
    && !credits.limitReachedReason?.includes('depleted')
    && !credits.limitReachedReason?.includes('usage_limit_reached'),
  );
};

const usageWindowOrder = (window: ProviderUsageWindow): number => {
  if (window.id === 'five_hour' || window.durationMinutes === 300) return 0;
  if (window.id === 'seven_day' || window.durationMinutes === 10_080) return 1;
  return 2;
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

const barToneFor = (fraction: number) => {
  if (fraction >= 0.9) return 'bg-red-500';
  if (fraction >= 0.75) return 'bg-amber-500';
  return 'bg-emerald-500';
};

function UsageWheel({
  fraction,
  tone,
  showCreditMarker,
}: {
  fraction: number;
  tone: string;
  showCreditMarker: boolean;
}) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <span className="relative grid h-5 w-5 place-items-center">
      <svg viewBox="0 0 20 20" className={cn('h-5 w-5 -rotate-90', tone)} aria-hidden>
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
      {showCreditMarker && (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center text-[8px] font-bold leading-none text-amber-500"
          aria-hidden
        >
          $
        </span>
      )}
    </span>
  );
}

function UsageBar({ utilization, thin = false }: { utilization: number; thin?: boolean }) {
  const clamped = Math.min(100, Math.max(0, utilization));
  return (
    <div className={cn('overflow-hidden rounded-full bg-muted', thin ? 'h-1' : 'h-1.5')}>
      <div
        className={cn('h-full rounded-full transition-[width]', barToneFor(clamped / 100))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

const planToneFor = (utilization: number): string | undefined => {
  if (utilization >= 90) return 'text-red-600 dark:text-red-400';
  if (utilization >= 75) return 'text-amber-600 dark:text-amber-400';
  return undefined;
};

/** Secondary plan lines under the limit tiles; the chevron column is reserved so values share one right edge. */
function PopoverRow({
  label,
  value,
  title,
  ariaLabel,
  onClick,
}: {
  label: string;
  value?: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{label}</span>
      {value !== undefined && value !== null && (
        <span className="shrink-0 tabular-nums text-muted-foreground">{value}</span>
      )}
      <span className="grid w-3.5 shrink-0 place-items-center text-muted-foreground">
        {onClick && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
      </span>
    </>
  );
  const className = 'flex min-h-9 w-full items-center gap-2 text-sm';

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn(className, 'rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      {content}
    </button>
  ) : (
    <div className={className} title={title}>{content}</div>
  );
}

/** A card per plan window; the card keeps each bar's end legible beside its neighbour. */
function PlanWindowTile({
  window,
  onViewUsage,
}: {
  window: ProviderUsageWindow;
  onViewUsage?: () => void;
}) {
  const { t } = useTranslation('common');
  const remaining = formatResetsIn(window.resetsAt);
  const utilization = Math.min(100, Math.max(0, window.utilization));
  const label = formatWindowLabel(window, t);
  const content = (
    <>
      <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {onViewUsage && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </span>
      <span className={cn('mb-1.5 mt-0.5 block text-left text-xl font-semibold leading-tight tabular-nums', planToneFor(utilization))}>
        {Math.round(utilization)}%
      </span>
      <UsageBar utilization={utilization} thin />
      {remaining && (
        <span className="mt-1.5 block truncate text-left text-[11px] tabular-nums text-muted-foreground">
          {t('usagePopover.resetsIn', { defaultValue: 'resets in {{time}}', time: remaining })}
        </span>
      )}
    </>
  );
  const className = 'block min-w-0 rounded-lg bg-muted/50 px-2.5 pb-2.5 pt-2';

  return onViewUsage ? (
    <button
      type="button"
      onClick={onViewUsage}
      aria-label={t('usagePopover.viewWindowUsage', { defaultValue: 'View {{window}} usage', window: label })}
      className={cn(className, 'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Half-width action with a small caption over its value, so it reads as a control rather than a line of text. */
function PopoverAction({
  caption,
  value,
  title,
  ariaLabel,
  onClick,
}: {
  caption: string;
  value: string;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="flex min-h-10 min-w-0 flex-1 items-center gap-1 rounded-lg bg-muted py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">{caption}</span>
        <span className="block truncate text-[13px] text-foreground">{value}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** Header placement uses the header menu's surface and anchoring so the two popovers match. */
function UsagePopoverSurface({
  id,
  inHeader,
  anchor,
  trigger,
  menuRef,
  onDismiss,
  measureKey,
  ariaLabel,
  children,
}: {
  id: string;
  inHeader: boolean;
  anchor: ComposerMenuAnchor | null;
  trigger: HTMLButtonElement | null;
  menuRef: React.Ref<HTMLDivElement>;
  onDismiss: () => void;
  measureKey: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (inHeader && trigger) {
    return (
      <ContextMenuOverlay
        anchor={anchorFromElement(trigger, { x: 0, y: 0 })}
        anchorElement={trigger}
        onDismiss={onDismiss}
        role="dialog"
        ariaLabel={ariaLabel}
        className={cn(HEADER_MENU_CLASS_NAME, 'w-[min(19rem,calc(100vw-1.25rem))] px-4 py-3')}
        measureKey={measureKey}
      >
        {children}
      </ContextMenuOverlay>
    );
  }
  if (!anchor) return null;
  return createPortal(
    <ComposerMenuSurface
      id={id}
      anchor={anchor}
      menuRef={menuRef}
      role="dialog"
      fillAnchorWidth
      className="px-4 py-3"
      ariaLabel={ariaLabel}
    >
      {children}
    </ComposerMenuSurface>,
    document.body,
  );
}

export default function TokenUsageSummary({
  usage,
  request,
  onRequestBreakdown,
  onRefreshBreakdown,
  isRefreshingBreakdown,
  canRefreshBreakdown,
  provider,
  model,
  sessionKey = null,
  inHeader = false,
}: TokenUsageSummaryProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<UsagePopoverView>('summary');
  const [contextData, setContextData] = useState<ContextCommandData | null>(null);
  const [promptCache, setPromptCache] = useState<PromptCache | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [derivedCeiling, setDerivedCeiling] = useState<Record<string, unknown> | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  // Seeded, not 0: the ring remounts on moving between header and composer and must not replay a served request.
  const handledRequestId = useRef(request.id);
  const sessionKeyRef = useRef(sessionKey);
  const popoverId = useId();
  const close = useCallback(() => setIsOpen(false), []);
  const { openSettings, openUsage } = usePaletteOps();
  const openAutoCompactSettings = useCallback(() => {
    setIsOpen(false);
    openSettings(agentScreenId('claude', 'autoCompact'));
  }, [openSettings]);
  // In the header, ContextMenuOverlay owns dismissal; the hook's outside-press would close on taps inside it.
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen && !inHeader, close, 19 * 16);
  const usageProvider = toUsageProvider(provider);
  const planUsage = useProviderUsage(usageProvider);
  const refreshPlanUsage = planUsage.refresh;
  const refreshPlanUsageIfStale = planUsage.refreshIfStale;

  // The composer outlives a session switch, so an expanded breakdown would keep
  // rendering the previous session's reading. A new chat gaining its id is the
  // same conversation, not a switch.
  useEffect(() => {
    const previousKey = sessionKeyRef.current;
    sessionKeyRef.current = sessionKey;
    if (previousKey === null || previousKey === sessionKey) return;
    setView((current) => (current === 'breakdown' ? 'summary' : current));
    setContextData(null);
    setBreakdownLoading(false);
    setPromptCache(null);
  }, [sessionKey]);

  useEffect(() => {
    if (request.id <= handledRequestId.current) return;

    handledRequestId.current = request.id;
    setView(request.view);
    if (request.view === 'breakdown') {
      setContextData(request.context ?? null);
      setBreakdownLoading(request.context === undefined);
    } else {
      setBreakdownLoading(false);
    }
    updateAnchor();
    setIsOpen(true);
    refreshPlanUsageIfStale();
  }, [request, updateAnchor, refreshPlanUsageIfStale]);
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const usageHasCeiling = readUsageNumber(usage?.total) > 0;

  // Live frames carry no cache timing, so the transcript is read on open. A new ring
  // count means a request just ran and refreshed the cache, so it reads again.
  useEffect(() => {
    if (!isOpen || provider !== 'claude' || !sessionKey) {
      setPromptCache(null);
      return undefined;
    }

    let cancelled = false;
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionKey)}/token-usage`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setPromptCache(readPromptCache(payload?.data?.promptCache));
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [isOpen, provider, sessionKey, usedTokens]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isOpen]);
  // A session that has never streamed reports no usage at all, and a bare "0
  // tokens" says nothing about the window it will run in or where compaction
  // will fire. The server derives both from the model and settings.json.
  useEffect(() => {
    // The composer outlives a session switch, so a ceiling fetched for one
    // provider must not stand in for the next one's.
    if (!isOpen || provider !== 'claude' || usageHasCeiling) {
      setDerivedCeiling(null);
      return undefined;
    }

    let cancelled = false;
    const query = model ? `?model=${encodeURIComponent(model)}` : '';
    authenticatedFetch(`/api/providers/claude/context-ceiling${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.data) setDerivedCeiling(payload.data as Record<string, unknown>);
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [isOpen, provider, usageHasCeiling, model]);

  const ceilingReading = usageHasCeiling || provider !== 'claude'
    ? usage
    : derivedCeiling ?? usage;
  const reportedWindow = readUsageNumber(ceilingReading?.total);
  const contextWindow =
    reportedWindow > 0
      ? reportedWindow
      : (provider ? PROVIDER_DEFAULT_CONTEXT_WINDOW[provider] ?? 0 : 0);
  // Withheld only while no window is known at all — printing the static
  // per-provider guess as a ceiling would show a number about to change.
  const hasMeasuredCeiling = reportedWindow > 0 || usedTokens > 0;
  const autoCompactThreshold = readUsageNumber(ceilingReading?.autoCompactThreshold);
  const compactsAutomatically = ceilingReading?.isAutoCompactEnabled === true
    && autoCompactThreshold > 0;

  // The ceiling that actually matters is where auto-compact fires, not the raw
  // window: at that point the conversation is summarised out from under the
  // user, so the tokens above it were never theirs to spend. Claude Code counts
  // the same way — its /context "Free space" is measured to the threshold, with
  // the remainder carved out as an "Autocompact buffer" slice. With auto-compact
  // off (or a provider that reports no threshold) the window IS the cliff, so it
  // stands as the ceiling.
  const effectiveCeiling = compactsAutomatically ? autoCompactThreshold : contextWindow;
  const fraction = effectiveCeiling > 0 ? usedTokens / effectiveCeiling : null;
  const utilization = fraction === null ? null : Math.min(Math.max(fraction, 0), 1);
  const percentUsed = utilization === null ? null : Math.round(utilization * 100);
  const providerUsage = planUsage.usage?.supported === true ? planUsage.usage : null;
  // An unrecognised id renders as a humanised slug ("Nimbus quill") with no way
  // to say what it limits. The usage dashboard lists every window; this panel
  // shows the ones it can name. Adding an id here is how a new one appears.
  const planWindows = [...(providerUsage?.windows ?? [])]
    .filter((window) => (
      window.id in KNOWN_WINDOW_LABELS
      || window.durationMinutes === 300
      || window.durationMinutes === 10_080
    ))
    .sort(
    (left, right) => usageWindowOrder(left) - usageWindowOrder(right),
  );
  const activityWindowId = providerUsage?.activity
    ? planWindows.find((window) => (
        window.id.startsWith('seven_day') || window.durationMinutes === 10_080
      ))?.id
    : undefined;
  const creditMarkerVisible = creditsAreAvailable(providerUsage?.credits);
  // Claude's own vocabulary: "auto" means no cap is configured, NOT "auto-compact
  // is enabled". Reporting the enabled flag under that word read as Claude's own
  // window while a user cap was in force, hiding an 80% cut. Name the source.
  const ceilingSource = typeof ceilingReading?.ceilingSource === 'string'
    ? ceilingReading.ceilingSource
    : null;
  const ceilingCap = readUsageNumber(ceilingReading?.ceilingCap);
  const modelContextWindow = readUsageNumber(ceilingReading?.modelContextWindow);
  const isCapped = ceilingCap > 0 && modelContextWindow > 0 && ceilingCap < modelContextWindow;
  const CEILING_SOURCE_LABELS: Record<string, { key: string; defaultValue: string }> = {
    auto: { key: 'usagePopover.ceilingAuto', defaultValue: 'Auto' },
    settings: { key: 'usagePopover.ceilingCustom', defaultValue: 'Custom' },
    env: { key: 'usagePopover.ceilingEnv', defaultValue: 'Env' },
  };
  const ceilingSourceLabel = ceilingSource ? CEILING_SOURCE_LABELS[ceilingSource] : undefined;
  const autoCompactIsOff = provider === 'claude' && usage?.isAutoCompactEnabled === false;
  const customCeilingLabel = ceilingSource && ceilingSource !== 'auto' && ceilingSourceLabel
    ? t(ceilingSourceLabel.key, { defaultValue: ceilingSourceLabel.defaultValue })
    : null;
  const autoCompactStatus = provider !== 'claude' || !hasMeasuredCeiling
    ? null
    : autoCompactIsOff
      ? t('usagePopover.autoCompactOff', { defaultValue: 'Off' })
      : compactsAutomatically
        ? [
            t('usagePopover.autoCompactAt', {
              defaultValue: 'At {{threshold}}',
              threshold: formatCompactTokens(autoCompactThreshold),
            }),
            customCeilingLabel,
          ].filter(Boolean).join(' · ')
        : customCeilingLabel ?? t('usagePopover.autoCompactOn', { defaultValue: 'On' });

  // Amber once little of the lifetime is left: the last 5 minutes of an hour, the last minute of 5.
  const cacheExpiresAt = promptCache
    ? Date.parse(promptCache.refreshedAt) + promptCache.ttlSeconds * 1000
    : null;
  const cacheRemainingMs = cacheExpiresAt === null ? null : cacheExpiresAt - now;
  const cacheIsCold = cacheRemainingMs !== null && cacheRemainingMs <= 0;
  const cacheIsEnding = cacheRemainingMs !== null
    && !cacheIsCold
    && cacheRemainingMs <= Math.min(300, promptCache!.ttlSeconds * 0.2) * 1000;
  const cacheMinutesLeft = cacheRemainingMs === null ? 0 : Math.floor(cacheRemainingMs / 60_000);
  const cacheStatus = cacheRemainingMs === null
    ? null
    : cacheIsCold
      ? t('usagePopover.cacheCold', {
          defaultValue: 'Cache cold · rewrites {{tokens}}',
          tokens: formatCompactTokens(usedTokens),
        })
      : cacheMinutesLeft < 1
        ? t('usagePopover.cacheUnderMinute', { defaultValue: 'Cache warm · <1m' })
        : t('usagePopover.cacheMinutesLeft', { defaultValue: 'Cache warm · {{count}}m', count: cacheMinutesLeft });
  const cacheHint = promptCache
    ? t('usagePopover.cacheHint', {
        defaultValue: 'A reply while the cache is warm re-reads this conversation at a fraction of the input price. Once it goes cold, the next message writes it all again at more than the full price. Lifetime: {{lifetime}} from the last request.',
        lifetime: promptCache.ttlSeconds >= 3600
          ? t('usagePopover.cacheLifetimeHour', { defaultValue: '1 hour' })
          : t('usagePopover.cacheLifetimeMinutes', { defaultValue: '{{count}} minutes', count: Math.round(promptCache.ttlSeconds / 60) }),
      })
    : undefined;
  const updatedAge = formatUpdatedAge(providerUsage?.fetchedAt, now, t);
  const hasPlanSection = planWindows.length > 0
    || Boolean(providerUsage?.credits)
    || (providerUsage?.resetCredits?.availableCount ?? 0) > 0
    || Boolean(providerUsage?.stale)
    || (!providerUsage && (planUsage.loading || Boolean(planUsage.error)));
  const openBreakdown = () => {
    setContextData(null);
    setBreakdownLoading(true);
    setView('breakdown');
    onRequestBreakdown();
  };

  const title =
    fraction === null || !hasMeasuredCeiling
      ? t('usagePopover.titleTokensUsed', {
          defaultValue: '{{used}} tokens used',
          used: usedTokens.toLocaleString(),
        })
      : compactsAutomatically
        ? t('usagePopover.titleBeforeAutoCompact', {
            defaultValue: '{{used}} / {{threshold}} tokens before auto-compact ({{percent}}%)\nAuto-compact rewrites the conversation here. Window: {{window}}{{capped}}.',
            used: usedTokens.toLocaleString(),
            threshold: autoCompactThreshold.toLocaleString(),
            percent: Math.round(Math.min(fraction, 1) * 100),
            window: contextWindow.toLocaleString(),
            capped: isCapped
              ? t('usagePopover.titleCappedFrom', {
                  defaultValue: ", capped from the model's {{modelWindow}}",
                  modelWindow: modelContextWindow.toLocaleString(),
                })
              : '',
            interpolation: { escapeValue: false },
          })
        : t('usagePopover.titleOfWindow', {
            defaultValue: '{{used}} / {{window}} tokens ({{percent}}% of context window)',
            used: usedTokens.toLocaleString(),
            window: contextWindow.toLocaleString(),
            percent: Math.round(Math.min(fraction, 1) * 100),
          });
  const accessibleTitle = creditMarkerVisible
    ? t('usagePopover.titleWithCredits', {
        defaultValue: '{{title}}\nUsage credits available.',
        title,
        interpolation: { escapeValue: false },
      })
    : title;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            close();
            return;
          }

          setView('summary');
          updateAnchor();
          setIsOpen(true);
          refreshPlanUsageIfStale();
        }}
        className={inHeader
          ? cn(
            'touch-menu-trigger inline-flex h-11 min-w-8 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isOpen && 'bg-accent/60 text-foreground',
          )
          : 'touch-menu-trigger inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'}
        title={accessibleTitle}
        aria-label={creditMarkerVisible
          ? t('usagePopover.showUsageWithCredits', { defaultValue: 'Show usage; credits available' })
          : t('usagePopover.showUsage', { defaultValue: 'Show usage' })}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen && !inHeader ? popoverId : undefined}
      >
        {fraction === null ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
            <ActivityIcon className="h-3.5 w-3.5" />
          </span>
        ) : (
          <UsageWheel
            fraction={fraction}
            tone={toneFor(Math.min(Math.max(fraction, 0), 1))}
            showCreditMarker={creditMarkerVisible}
          />
        )}
        <span className="hidden font-medium text-foreground md:inline">{formatTokenCount(usedTokens)}</span>
      </button>
      {isOpen && (inHeader ? triggerRef.current : anchor) && (
        <UsagePopoverSurface
          id={popoverId}
          inHeader={inHeader}
          anchor={anchor}
          trigger={triggerRef.current}
          menuRef={menuRef}
          onDismiss={close}
          measureKey={`${view}:${breakdownLoading}:${planUsage.loading}:${Boolean(cacheStatus)}`}
          ariaLabel={view === 'summary'
            ? t('usagePopover.summaryLabel', { defaultValue: 'Session and plan usage' })
            : view === 'breakdown'
              ? t('contextBreakdown.title', { defaultValue: 'Context breakdown' })
              : t('usagePopover.activity', { defaultValue: 'Usage activity' })}
        >
          {view !== 'breakdown' && (
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t('usagePopover.heading', { defaultValue: 'Context & Usage' })}
              </span>
              <span className="flex items-center gap-1">
                {updatedAge && <span className="text-[11px] text-muted-foreground">{updatedAge}</span>}
                <button
                  type="button"
                  onClick={refreshPlanUsage}
                  disabled={!usageProvider || planUsage.loading}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  aria-label={t('buttons.refresh', { defaultValue: 'Refresh' })}
                  title={t('buttons.refresh', { defaultValue: 'Refresh' })}
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', planUsage.loading && 'animate-spin')}
                    aria-hidden
                  />
                </button>
              </span>
            </div>
          )}
          {view === 'summary' && (
            <div>
              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5">
                  <div className="min-w-0">
                    <div className={cn('text-3xl font-semibold leading-none tracking-tight tabular-nums', (percentUsed !== null && planToneFor(percentUsed)) || 'text-foreground')}>
                      {percentUsed === null ? formatCompactTokens(usedTokens) : `${percentUsed}%`}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {effectiveCeiling > 0 && hasMeasuredCeiling
                        ? t('usagePopover.sessionOfCeiling', {
                            defaultValue: '{{used}} of {{ceiling}} context',
                            used: formatCompactTokens(usedTokens),
                            ceiling: formatCompactTokens(effectiveCeiling),
                          })
                        : percentUsed === null
                          ? t('usagePopover.sessionInContext', { defaultValue: 'tokens in context' })
                          : t('usagePopover.sessionTokens', {
                              defaultValue: '{{used}} tokens in context',
                              used: formatCompactTokens(usedTokens),
                            })}
                    </div>
                  </div>
                  {cacheStatus && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs tabular-nums',
                        cacheIsCold || cacheIsEnding
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      )}
                      title={cacheHint}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                      {cacheStatus}
                    </span>
                  )}
                </div>
                {percentUsed !== null && <UsageBar utilization={percentUsed} />}
              </section>

              {(autoCompactStatus || provider === 'claude') && (
                <div className="mt-2.5 flex gap-1.5">
                  {autoCompactStatus && (
                    <PopoverAction
                      caption={t('usagePopover.autoCompact', { defaultValue: 'Auto-compact' })}
                      value={autoCompactStatus}
                      title={autoCompactIsOff
                        ? t('usagePopover.autoCompactOffHint', {
                            defaultValue: 'Auto-compact is off: this session stops at the context limit instead of being summarised. Tap to change.',
                          })
                        : t('usagePopover.autoCompactOnHint', {
                            defaultValue: 'Auto-compact rewrites the conversation at the compact point. Tap to change.',
                          })}
                      onClick={openAutoCompactSettings}
                    />
                  )}
                  {provider === 'claude' && (
                    <PopoverAction
                      caption={t('usagePopover.breakdownCaption', { defaultValue: 'Context' })}
                      value={t('usagePopover.breakdownAction', { defaultValue: 'Breakdown' })}
                      ariaLabel={t('contextBreakdown.title', { defaultValue: 'Context breakdown' })}
                      onClick={openBreakdown}
                    />
                  )}
                </div>
              )}

              {hasPlanSection && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('usagePopover.planLimits', { defaultValue: 'Plan limits' })}
                  </div>
                  {planWindows.length > 0 && (
                    <div className={cn('grid gap-1.5', planWindows.length > 1 && 'grid-cols-2')}>
                      {planWindows.map((window) => (
                        <PlanWindowTile
                          key={window.id}
                          window={window}
                          onViewUsage={window.id === activityWindowId
                            ? () => setView('activity')
                            : undefined}
                        />
                      ))}
                    </div>
                  )}

                  {providerUsage?.credits && (
                    <PopoverRow
                      label={t('usagePopover.creditsTokens', { defaultValue: 'Credits/Tokens' })}
                      value={formatCreditValue(providerUsage.credits, t)}
                      title={providerUsage.credits.kind === 'spend'
                        ? t('usagePopover.creditSpendHint', { defaultValue: 'Usage-credit spend this period' })
                        : t('planUsage.creditBalance', { defaultValue: 'Credit balance' })}
                    />
                  )}

                  {(providerUsage?.resetCredits?.availableCount ?? 0) > 0 && (
                    <PopoverRow
                      label={providerUsage?.resetCredits?.availableCount === 1
                        ? t('usagePopover.oneResetAvailable', { defaultValue: '1 usage reset available' })
                        : t('usagePopover.resetsAvailable', {
                          defaultValue: '{{count}} usage resets available',
                          count: providerUsage?.resetCredits?.availableCount,
                        })}
                      value={t('usagePopover.viewUsage', { defaultValue: 'View usage' })}
                      onClick={() => {
                        close();
                        openUsage();
                      }}
                    />
                  )}

                  {providerUsage?.stale && (
                    <p className="py-2 text-xs text-amber-600 dark:text-amber-400">
                      {t('planUsage.stale', {
                        defaultValue: 'Showing cached data — the last refresh failed.',
                      })}
                    </p>
                  )}

                  {!providerUsage && planUsage.loading && (
                    <p className="py-2 text-xs text-muted-foreground">
                      {t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}
                    </p>
                  )}

                  {!providerUsage && !planUsage.loading && planUsage.error && (
                    <p className="py-2 text-xs text-muted-foreground">
                      {t('planUsage.loadError', { defaultValue: "Couldn't load plan usage." })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {view === 'breakdown' && (
            <ContextBreakdownView
              data={contextData}
              loading={breakdownLoading}
              cap={isCapped ? { cap: ceilingCap, modelWindow: modelContextWindow } : undefined}
              onBack={() => setView('summary')}
              onRefresh={onRefreshBreakdown}
              isRefreshing={isRefreshingBreakdown}
              canRefresh={canRefreshBreakdown}
            />
          )}
          {view === 'activity' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setView('summary')}
                className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {t('usagePopover.activity', { defaultValue: 'Usage activity' })}
              </button>
              {providerUsage?.activity ? (
                <UsageActivitySection
                  activity={providerUsage.activity}
                  showDivider={false}
                  showHeading={false}
                />
              ) : planUsage.loading ? (
                <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {t('planUsage.loading', { defaultValue: 'Loading plan usage…' })}
                </p>
              ) : (
                <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {t('usagePopover.noActivity', {
                    defaultValue: 'No usage activity is reported for this account.',
                  })}
                </p>
              )}
            </div>
          )}
        </UsagePopoverSurface>
      )}
    </>
  );
}
