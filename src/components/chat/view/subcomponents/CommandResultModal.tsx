import { useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coins,
  Cpu,
  Gauge,
  Package,
  Search,
  Server,
  Sparkles,
  TerminalSquare,
  Timer,
  RefreshCw,
  X,
} from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import UsageWindowList from '../../../provider-usage/UsageWindowList';
import { useProviderUsage } from '../../../provider-usage/hooks/useProviderUsage';
import type { LLMProvider, ProviderModelsCacheInfo, ProviderModelsDefinition } from '../../../../types/app';
import type {
  CommandModalPayload,
  ContextCommandData,
  ContextNamedTokens,
  UsageCommandData,
  HelpCommandData,
  ModelCommandData,
  StatusCommandData,
} from '../../hooks/useChatComposerState';

type CommandResultModalProps = {
  payload: CommandModalPayload | null;
  onClose: () => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  /** Re-opens this modal on the `/usage` view — the context panel links to it. */
  onShowUsage?: () => void;
  /** Re-fires the SDK context reading and re-opens the modal with it. Claude only — see the context spec. */
  onRefreshContext?: () => void;
  isRefreshingContext?: boolean;
  /** The reading can only change while a turn is streaming; gates the refresh button. */
  isSessionProcessing?: boolean;
  onSelectProviderModel: (
    provider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => Promise<{
    scope: 'default' | 'session';
    changed: boolean;
    model: string;
  }>;
};

type CommandEntry = {
  name: string;
  description?: string;
  namespace?: string;
};

type ModelOption = {
  value: string;
  label?: string;
  description?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

const FALLBACK_COMMANDS: CommandEntry[] = [
  { name: '/models', description: 'Browse available models for the active provider.' },
  { name: '/usage', description: 'Review your plan limits and this session’s token usage.' },
  { name: '/context', description: 'See what is filling the context window.' },
  { name: '/status', description: 'Inspect runtime, version, provider, and environment status.' },
  { name: '/memory', description: 'Open the project CLAUDE.md memory file.' },
  { name: '/config', description: 'Open settings and configuration.' },
  { name: '/help', description: 'Show command documentation and syntax.' },
];

const getProviderLabel = (provider: string | undefined, fallback = 'Unknown') => {
  if (!provider) {
    return fallback;
  }

  return PROVIDER_LABELS[provider] || provider;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

// Plan usage is fetched per provider, and only the four known providers have an
// endpoint at all. Anything else (an unknown provider string on an old payload)
// disables the fetch rather than requesting a 404.
const toUsageProvider = (provider: string | undefined): LLMProvider | null => (
  provider === 'claude' || provider === 'cursor' || provider === 'codex' || provider === 'opencode'
    ? provider
    : null
);

/**
 * The plan's rate-limit windows (5-hour, weekly) with a refresh control.
 *
 * Shown in two places, deliberately: `/usage` renders the whole account picture
 * (windows, credits, activity), while the context panel appends `windowsOnly`
 * limits under the context breakdown — the pairing Claude Code shows when you
 * expand its status line. Renders nothing when the provider or auth method
 * reports no plan usage, so the embedding surfaces need no provider gating.
 */
function PlanUsagePanel({
  provider,
  title,
  windowsOnly = false,
  onViewAll,
}: {
  provider: LLMProvider | null;
  title: string;
  windowsOnly?: boolean;
  /** Swaps this modal over to the full `/usage` view. */
  onViewAll?: () => void;
}) {
  const planUsage = useProviderUsage(provider);

  if (!provider || planUsage.usage?.supported === false) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onViewAll && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onViewAll}
              className="h-7 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Full usage
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={planUsage.refresh}
            disabled={planUsage.loading}
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Refresh plan usage"
          >
            <RefreshCw className={planUsage.loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          </Button>
        </div>
      </div>
      <UsageWindowList
        usage={planUsage.usage}
        loading={planUsage.loading}
        error={planUsage.error}
        windowsOnly={windowsOnly}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  compact = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'primary' | 'success';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary/35 bg-primary/10 text-primary'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-border/70 bg-background/75 text-muted-foreground';

  return (
    <div
      className={`group rounded-2xl border border-border/70 bg-background/75 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className={`inline-flex rounded-xl border ${compact ? 'mb-2 p-1.5' : 'mb-3 p-2'} ${toneClass}`}>
        <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} break-all font-semibold text-foreground`}>{value}</p>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-background/75 pl-9 pr-3 shadow-none focus-visible:ring-primary/40"
      />
    </div>
  );
}

function HelpContent({ data }: { data: HelpCommandData }) {
  const [query, setQuery] = useState('');
  const commands = (Array.isArray(data.commands) && data.commands.length > 0
    ? data.commands
    : FALLBACK_COMMANDS) as CommandEntry[];

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }

    return commands.filter((command) => {
      const haystack = `${command.name} ${command.description || ''} ${command.namespace || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-0 flex-col gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Filter commands..." />

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredCommands.map((command, index) => (
              <div
                key={`${command.namespace || 'builtin'}-${command.name}`}
                className="settings-content-enter rounded-2xl border border-border/70 bg-background/75 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/25"
                style={{ animationDelay: `${Math.min(index * 18, 160)}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <code className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {command.name}
                  </code>
                  <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                    {command.namespace || 'builtin'}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  {command.description || 'No description available.'}
                </p>
              </div>
            ))}
          </div>

          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              No commands match that filter.
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TerminalSquare className="h-4 w-4 text-primary" />
            Syntax
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><code className="text-foreground">/command arg1 arg2</code></p>
            <p><code className="text-foreground">$ARGUMENTS</code> passes all args.</p>
            <p><code className="text-foreground">$1</code>, <code className="text-foreground">$2</code> pass positional args.</p>
            <p><code className="text-foreground">@file</code> includes file contents.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Quick tip
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            Type <code className="text-foreground">/</code> in the composer to open the command palette, then use arrows and Enter to run a command.
          </p>
        </div>
      </aside>
    </div>
  );
}

function ModelsContent({
  data,
  providerModelCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onSelectProviderModel,
}: {
  data: ModelCommandData;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  onSelectProviderModel: CommandResultModalProps['onSelectProviderModel'];
}) {
  const [query, setQuery] = useState('');
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [pendingSessionModel, setPendingSessionModel] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const currentProvider = (data?.current?.provider || 'claude') as LLMProvider;
  const hasConcreteSessionId = typeof currentSessionId === 'string' && currentSessionId.trim().length > 0;
  // For a fresh session (no session id yet) the "active" model is whatever the
  // new-session picker chose, held in localStorage `${provider}-model` — the same
  // source the empty-state header reads. Falling back to the server-resolved model
  // here would show "default" while the header (and the first turn) actually use the
  // picked model, so keep the popup in sync with the header until the session exists.
  const newSessionModel = useMemo(() => {
    if (hasConcreteSessionId) return null;
    try {
      return localStorage.getItem(`${currentProvider}-model`);
    } catch {
      return null;
    }
  }, [hasConcreteSessionId, currentProvider]);
  const currentModel =
    (!hasConcreteSessionId && newSessionModel) || data?.current?.model || 'Unknown';
  const providerLabel = data?.current?.providerLabel || getProviderLabel(currentProvider);
  const liveDefinition = providerModelCatalog[currentProvider];
  const availableOptions = useMemo<ModelOption[]>(() => {
    if (liveDefinition?.OPTIONS && liveDefinition.OPTIONS.length > 0) {
      return liveDefinition.OPTIONS;
    }

    if (Array.isArray(data?.availableOptions) && data.availableOptions.length > 0) {
      return data.availableOptions;
    }

    const availableModels = Array.isArray(data?.availableModels) ? data.availableModels : [];
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [data, liveDefinition]);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return availableOptions;
    }

    return availableOptions.filter((option) => {
      const haystack = `${option.value} ${option.label || ''} ${option.description || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [availableOptions, query]);

  const showSearch = availableOptions.length > 6;

  const handleSelectModel = async (model: string) => {
    setChangingModel(model);
    try {
      const result = await onSelectProviderModel(currentProvider, model, currentSessionId);
      if (result.scope === 'session') {
        setPendingSessionModel(result.model);
        setSelectionNotice(`Next response will resume with ${result.model}.`);
        return;
      }

      setPendingSessionModel(null);
      setSelectionNotice(`Default ${providerLabel} model set to ${result.model}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to change the model right now.';
      setSelectionNotice(message);
    } finally {
      setChangingModel(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Compact context bar: active model + refresh, no clutter */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Active model · {providerLabel}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-all font-mono text-sm font-semibold text-foreground">{currentModel}</span>
            {pendingSessionModel && pendingSessionModel !== currentModel && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-500 dark:text-emerald-400">
                → {pendingSessionModel} next
              </span>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onHardRefreshProviderModels}
          disabled={providerModelsRefreshing}
          title="Refresh model list from providers"
          aria-label="Refresh model list from providers"
          className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-4 w-4 ${providerModelsRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {showSearch && (
        <SearchField value={query} onChange={setQuery} placeholder={`Search ${providerLabel} models...`} />
      )}

      {filteredOptions.length > 0 ? (
        <div className="scrollbar-thin -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 md:grid-cols-2">
            {filteredOptions.map((option, index) => {
              const isCurrent = option.value === currentModel;
              const isPendingSelection = option.value === pendingSessionModel;
              const isChanging = option.value === changingModel;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectModel(option.value)}
                  disabled={Boolean(changingModel)}
                  aria-label={`Select model ${option.value}`}
                  className={`settings-content-enter group flex min-h-[4rem] flex-col rounded-2xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 ${
                    isCurrent
                      ? 'border-primary/45 bg-primary/10'
                      : isPendingSelection
                        ? 'border-emerald-500/35 bg-emerald-500/10'
                        : 'border-border/70 bg-background/80 hover:border-primary/30 hover:bg-background'
                  }`}
                  style={{ animationDelay: `${Math.min(index * 14, 180)}ms` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-sm font-semibold text-foreground">{option.value}</span>
                    {isCurrent ? (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                    ) : isChanging ? (
                      <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    ) : null}
                  </span>
                  {option.label && option.label !== option.value && (
                    <span className="mt-1 text-xs font-medium text-foreground/85">{option.label}</span>
                  )}
                  {option.description && (
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</span>
                  )}
                  {isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Current selection</span>
                  )}
                  {isPendingSelection && !isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-500 dark:text-emerald-400">
                      Applies next response
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
          No models match that search.
        </div>
      )}

      {/* Single quiet line of guidance / feedback */}
      {(selectionNotice || hasConcreteSessionId) && (
        <p className="shrink-0 text-[11px] leading-4 text-muted-foreground">
          {selectionNotice ? (
            <span className="text-foreground">{selectionNotice}</span>
          ) : (
            'Your choice applies to this session on the next response.'
          )}
        </p>
      )}
    </div>
  );
}

// The CLI names its own colours for the /context squares. Mapping them onto
// theme tokens keeps the two views recognisably the same picture without
// hardcoding hex values that would fight the light/dark themes.
const CONTEXT_CATEGORY_COLORS: Record<string, string> = {
  blue: 'bg-sky-500',
  cyan: 'bg-cyan-500',
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  magenta: 'bg-fuchsia-500',
  purple: 'bg-violet-500',
  gray: 'bg-muted-foreground/40',
  grey: 'bg-muted-foreground/40',
};

// "Free space" is not consumption, and the auto-compact buffer is reserved
// rather than spent — both are still worth showing, just not as usage.
const isReservedCategory = (name: string) =>
  /free space|autocompact|auto-compact/i.test(name);

const isAutoCompactBuffer = (name: string) => /autocompact|auto-compact/i.test(name);

function ContextSection({
  title,
  entries,
  total,
  totalLabel = 'Total',
}: {
  title: string;
  entries: Array<{ key: string; label: string; hint?: string; tokens: number }>;
  /** Shown as a footer row, so the section's numbers can be checked against it. */
  total?: number;
  /** What the footer row is the total *of*, when it is not the entries above. */
  totalLabel?: string;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      {/* Every figure in these sections is a token count, but the rows read
          like inventories ("Your messages  8"), so the column needs a unit or
          it gets read as "8 messages". One caption per section beats
          repeating a suffix on every row. */}
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </p>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
          tokens
        </span>
      </div>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <span className="block truncate text-sm text-foreground">{entry.label}</span>
              {entry.hint && (
                <span className="block truncate text-xs text-muted-foreground" title={entry.hint}>
                  {entry.hint}
                </span>
              )}
            </div>
            <span className="shrink-0 font-mono text-sm text-muted-foreground">
              {formatNumber(entry.tokens)}
            </span>
          </div>
        ))}
      </div>

      {typeof total === 'number' && (
        <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border/70 pt-2">
          <span className="text-sm text-foreground">{totalLabel}</span>
          <span className="shrink-0 font-mono text-sm text-foreground">{formatNumber(total)}</span>
        </div>
      )}
    </div>
  );
}

// Memory files are all called CLAUDE.md, so the basename alone gives two
// identical rows. The distinguishing part of the path is its tail, which is
// exactly what truncation eats on a phone — keep the last couple of segments
// and let the full path live in the tooltip.
const shortenPath = (value: string) => {
  const segments = value.split('/').filter(Boolean);
  return segments.length <= 3 ? value : `…/${segments.slice(-3).join('/')}`;
};

// The reading is whatever the last turn recorded, so the modal says how old it
// is rather than implying it is live.
function formatReadingAge(fetchedAt: number | undefined): string | null {
  if (!fetchedAt) {
    return null;
  }

  const minutes = Math.round((Date.now() - fetchedAt) / 60000);
  if (minutes < 1) {
    return 'Measured just now.';
  }
  if (minutes < 60) {
    return `Measured ${minutes} min ago.`;
  }

  const hours = Math.round(minutes / 60);
  return hours < 24
    ? `Measured ${hours} h ago.`
    : `Measured ${Math.round(hours / 24)} d ago.`;
}

function ContextContent({
  data,
  onShowUsage,
  onRefresh,
  isRefreshing = false,
  canRefresh = false,
}: {
  data: ContextCommandData;
  /** Opens the full `/usage` view from the plan-limits footer. */
  onShowUsage?: () => void;
  /** Re-fires the SDK reading. Omitted entirely hides the button (e.g. no session yet). */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** The reading can only change while a turn is streaming. */
  canRefresh?: boolean;
}) {
  const maxTokens = Number(data.maxTokens ?? 0);
  // The headline follows current usage; the sections describe the reading.
  const totalTokens = Number(data.usedTokens ?? data.totalTokens ?? 0);
  const readingAge = formatReadingAge(data.fetchedAt);
  const threshold = Number(data.autoCompactThreshold ?? 0);
  const compactsAutomatically = data.isAutoCompactEnabled === true && threshold > 0;
  // Same ceiling the composer ring uses: usable space ends where auto-compact
  // fires. The categories agree — "Free space" is measured to the threshold,
  // and the leftover is the "Autocompact buffer" listed under Reserved.
  const ceiling = compactsAutomatically ? threshold : maxTokens;
  const breakdown = data.breakdown;
  // Twelve itemised sections is a lot of phone scrolling to reach the plan
  // limits underneath. The headline and the limits are what the panel is
  // opened for; the itemisation is what you go looking for.
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

  // The CLI's own arithmetic, verified against a real reading: the non-deferred
  // categories sum to the whole window, and the non-deferred, non-reserved ones
  // sum to totalTokens. Deferred tools sit outside both — they are what *would*
  // load on demand — so listing them alongside the rest made the visible column
  // add up to more than the headline.
  const categories = (breakdown?.categories ?? []).filter((category) => category.tokens > 0);
  const counted = categories.filter((category) => !category.isDeferred);
  const spent = counted.filter((category) => !isReservedCategory(category.name));
  const reserved = counted.filter((category) => isReservedCategory(category.name));
  const deferred = categories.filter((category) => category.isDeferred);
  const spentTotal = spent.reduce((sum, category) => sum + category.tokens, 0);
  // "Free space" is measured to the auto-compact threshold, while the buffer is
  // the slice above it, so the two only reconcile against the whole window —
  // a number the headline never shows (it shows the threshold). Without it the
  // column reads as used + buffer + free ≠ the header.
  const reservedTotal = reserved.reduce((sum, category) => sum + category.tokens, 0);
  const windowTotal = spentTotal + reservedTotal;

  const messages = breakdown?.messageBreakdown;
  const messageEntries: Array<{ key: string; label: string; tokens: number }> = messages
    ? [
        { key: 'user', label: 'Your messages', tokens: messages.userMessageTokens },
        { key: 'assistant', label: 'Replies', tokens: messages.assistantMessageTokens },
        { key: 'toolCalls', label: 'Tool calls', tokens: messages.toolCallTokens },
        { key: 'toolResults', label: 'Tool results', tokens: messages.toolResultTokens },
        { key: 'attachments', label: 'Attachments', tokens: messages.attachmentTokens },
        { key: 'redirected', label: 'Redirected context', tokens: messages.redirectedContextTokens },
        { key: 'unattributed', label: 'Unattributed', tokens: messages.unattributedTokens },
      ].filter((entry) => entry.tokens > 0)
    : [];

  const named = (entries: ContextNamedTokens[] | undefined, prefix: string) =>
    (entries ?? [])
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({ key: `${prefix}-${entry.name}`, label: entry.name, tokens: entry.tokens }));

  // Auto-compact is only known from a reading; without one, say what is missing
  // and how to get it instead of asserting that compaction is off.
  const statusLine = data.detail === 'headline'
    ? (data.message || 'Send a message to see what is filling the window.')
    : compactsAutomatically
      ? maxTokens > threshold
        ? `Auto-compacts at ${formatNumber(threshold)} of the ${formatNumber(maxTokens)}-token window.`
        : `Auto-compacts at ${formatNumber(threshold)} tokens.`
      : 'Auto-compact is off for this session.';

  // Only Claude reports a breakdown, but the other providers still have plan
  // limits — and this panel is what the composer ring opens for all of them, so
  // "no breakdown" must not mean an empty modal.
  if (data.unsupported) {
    return (
      <div className="scrollbar-thin -mr-1 h-full min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-border/70 bg-background/75 p-6 text-center">
          <Gauge className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {data.message || 'No context breakdown available.'}
          </p>
        </div>

        <PlanUsagePanel
          provider={toUsageProvider(data.provider)}
          title="Plan usage limits"
          windowsOnly
          onViewAll={onShowUsage}
        />
      </div>
    );
  }

  return (
    <div className="scrollbar-thin -mr-1 h-full min-h-0 space-y-4 overflow-y-auto pr-1">
      <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-medium text-foreground">
            {formatNumber(totalTokens)}
            <span className="text-muted-foreground">
              {' / '}{formatNumber(ceiling)} tokens{compactsAutomatically ? ' before auto-compact' : ''}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <p className="font-mono text-sm text-muted-foreground">
              {ceiling > 0 ? `${Math.round((totalTokens / ceiling) * 100)}%` : '—'}
            </p>
            {onRefresh && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                disabled={isRefreshing || !canRefresh}
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="Refresh context reading"
                title={canRefresh ? 'Refresh context reading' : 'The reading only updates while a turn is streaming'}
              >
                <RefreshCw className={isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </Button>
            )}
          </div>
        </div>

        {/* One stacked bar in the CLI's own category colours. */}
        {spent.length > 0 && ceiling > 0 && (
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {spent.map((category) => (
              <span
                key={category.name}
                className={CONTEXT_CATEGORY_COLORS[category.color ?? ''] || 'bg-primary'}
                style={{ width: `${(category.tokens / ceiling) * 100}%` }}
                title={`${category.name}: ${formatNumber(category.tokens)}`}
              />
            ))}
          </div>
        )}

        {/* Without a reading there are no slices to colour, but the total is
            still known — show it as one bar instead of nothing. */}
        {spent.length === 0 && ceiling > 0 && totalTokens > 0 && (
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="bg-primary"
              style={{ width: `${Math.min(100, (totalTokens / ceiling) * 100)}%` }}
            />
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          {statusLine}
          {data.model ? ` Model: ${data.model}.` : ''}
          {readingAge ? ` ${readingAge}` : ''}
        </p>
      </div>

      {breakdown && (
        <button
          type="button"
          onClick={() => setIsBreakdownOpen((previous) => !previous)}
          aria-expanded={isBreakdownOpen}
          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/75 p-4 text-left transition-colors hover:bg-muted/40"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Full breakdown
          </span>
          {isBreakdownOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      )}

      {breakdown && isBreakdownOpen && (
        <>
          <ContextSection
            title="What is in the window"
            entries={spent.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
            total={spentTotal}
          />

          <ContextSection
            title="Reserved"
            entries={[
              { key: 'in-use', label: 'In use (listed above)', tokens: spentTotal },
              ...reserved.map((category) => ({
                key: category.name,
                label: category.name,
                hint: !compactsAutomatically
                  ? undefined
                  : isAutoCompactBuffer(category.name)
                    ? `Never usable — sits above the ${formatNumber(threshold)} threshold`
                    : 'Room left before auto-compact fires',
                tokens: category.tokens,
              })),
            ]}
            total={maxTokens > 0 && windowTotal === maxTokens ? maxTokens : undefined}
            totalLabel="Context window"
          />

          <ContextSection
            title="Not counted — loaded on demand"
            entries={deferred.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
          />

          <ContextSection title="Messages" entries={messageEntries} />

          <ContextSection
            title="Attachments"
            entries={named(messages?.attachmentsByType, 'attachment')}
          />

          <ContextSection
            title="Memory files"
            entries={(breakdown?.memoryFiles ?? [])
              .filter((file) => file.tokens > 0)
              .map((file) => {
                const name = file.path.split('/').pop() || file.path;
                return {
                  key: file.path,
                  // The scope the CLI resolved it at (User / Project / Local) is
                  // what actually tells two CLAUDE.md rows apart.
                  label: file.type ? `${name} — ${file.type}` : name,
                  hint: shortenPath(file.path),
                  tokens: file.tokens,
                };
              })}
          />

          <ContextSection
            title="MCP tools"
            entries={(breakdown?.mcpTools ?? [])
              .filter((tool) => tool.tokens > 0)
              .map((tool) => ({
                key: `${tool.serverName ?? ''}-${tool.name}`,
                label: tool.name,
                hint: tool.serverName,
                tokens: tool.tokens,
              }))}
          />

          <ContextSection title="System tools" entries={named(breakdown?.systemTools, 'tool')} />

          <ContextSection
            title="System prompt"
            entries={named(breakdown?.systemPromptSections, 'prompt')}
          />

          <ContextSection
            title="Agents"
            entries={(breakdown?.agents ?? [])
              .filter((agent) => agent.tokens > 0)
              .map((agent) => ({
                key: agent.name,
                label: agent.name,
                hint: agent.source,
                tokens: agent.tokens,
              }))}
          />

          {/* An inventory of what was loaded, not extra consumption: these tokens
              are already inside the categories above. Skills get their own slice
              there; slash commands do not, so the hints say where each one landed
              rather than leaving a number that matches nothing. */}
          {(breakdown.skills || breakdown.slashCommands) && (
            <ContextSection
              title="Loaded on startup — already counted above"
              entries={[
                ...(breakdown.skills
                  ? [{
                    key: 'skills',
                    label: `Skills (${breakdown.skills.includedSkills} of ${breakdown.skills.totalSkills})`,
                    hint: 'Listed above as Skills',
                    tokens: breakdown.skills.tokens,
                  }]
                  : []),
                ...(breakdown.slashCommands
                  ? [{
                    key: 'commands',
                    label: `Slash commands (${breakdown.slashCommands.includedCommands} of ${breakdown.slashCommands.totalCommands})`,
                    hint: 'No slice of its own — part of the system prompt',
                    tokens: breakdown.slashCommands.tokens,
                  }]
                  : []),
              ].filter((entry) => entry.tokens > 0)}
            />
          )}

          {data.fetchedAt && (
            <p className="px-1 text-xs text-muted-foreground">
              Read from the session at {new Date(data.fetchedAt).toLocaleTimeString()}.
            </p>
          )}
        </>
      )}

      {/* The context window is one of two ceilings a turn can hit; the plan's
          own windows are the other, and they are what stops the next message
          entirely. Claude Code pairs them for the same reason. */}
      <PlanUsagePanel
        provider={toUsageProvider(data.provider)}
        title="Plan usage limits"
        windowsOnly
        onViewAll={onShowUsage}
      />
    </div>
  );
}

function UsageContent({ data }: { data: UsageCommandData }) {
  const usageProvider = toUsageProvider(data.provider);
  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const model = data.model || 'Unknown';
  const provider = getProviderLabel(data.provider, data.provider || 'Unknown');
  const hasBreakdown =
    typeof data.tokenBreakdown?.input === 'number' ||
    typeof data.tokenBreakdown?.output === 'number';
  const usageRows = [
    { label: 'Total tokens used', value: formatNumber(used), icon: Activity },
    ...(hasBreakdown
      ? [
          {
            label: 'Input tokens',
            value: formatNumber(Number(data.tokenBreakdown?.input ?? 0)),
            icon: TerminalSquare,
          },
          {
            label: 'Output tokens',
            value: formatNumber(Number(data.tokenBreakdown?.output ?? 0)),
            icon: Coins,
          },
        ]
      : [
          {
            label: 'Breakdown',
            value: 'Unavailable',
            icon: TerminalSquare,
          },
        ]),
    ...(total > 0
      ? [{ label: 'Context window', value: formatNumber(total), icon: Gauge }]
      : []),
  ];

  return (
    <div className="scrollbar-thin -mr-1 h-full min-h-0 space-y-4 overflow-y-auto pr-1">
      {/* Plan limits lead: they are what the command is now named for, and they
          are the number that decides whether the next message can be sent at
          all. Session token counts are the detail underneath. */}
      <PlanUsagePanel provider={usageProvider} title="Plan usage" />

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            This session
          </p>
        </div>
        {usageRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{provider}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Model</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{model}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusContent({ data }: { data: StatusCommandData }) {
  const memoryRssMb = data.memoryUsage?.rssMb;
  const rows = [
    { label: 'Package', value: data.packageName || 'claude-code-ui', icon: Package },
    { label: 'Version', value: data.version || 'Unknown', icon: BadgeCheck, tone: 'success' as const },
    { label: 'Uptime', value: data.uptime || 'Unknown', icon: Timer },
    { label: 'Provider', value: getProviderLabel(data.provider, data.provider || 'Unknown'), icon: Server, tone: 'primary' as const },
    { label: 'Model', value: data.model || 'Unknown', icon: Cpu },
    { label: 'Node.js', value: data.nodeVersion || 'Unknown', icon: TerminalSquare },
    { label: 'Platform', value: data.platform || 'Unknown', icon: Activity },
    { label: 'Memory', value: typeof memoryRssMb === 'number' ? `${memoryRssMb} MB RSS` : 'Unknown', icon: Gauge },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Runtime online</p>
            <p className="text-xs text-muted-foreground">Process {data.pid ? `#${data.pid}` : 'status'} is responding.</p>
          </div>
        </div>
        <Badge className="rounded-full bg-emerald-500 text-white hover:bg-emerald-500">Healthy</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => (
          <MetricCard key={row.label} label={row.label} value={String(row.value)} icon={row.icon} tone={row.tone} />
        ))}
      </div>
    </div>
  );
}

export default function CommandResultModal({
  payload,
  onClose,
  providerModelCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onShowUsage,
  onRefreshContext,
  isRefreshingContext,
  isSessionProcessing,
  onSelectProviderModel,
}: CommandResultModalProps) {
  const isOpen = Boolean(payload);
  const kind = payload?.kind;
  const isModelsModal = kind === 'models';

  const modalMeta = {
    help: {
      eyebrow: 'Command center',
      title: 'Help & Shortcuts',
      subtitle: 'Search built-ins, syntax patterns, and command usage without leaving the chat.',
      icon: CircleHelp,
    },
    models: {
      eyebrow: 'Model selection',
      title: 'Choose a Model',
      subtitle: 'Pick the model this provider should use.',
      icon: Cpu,
    },
    usage: {
      eyebrow: 'Plan & session',
      title: 'Usage',
      subtitle: 'Your plan limits and credits, plus token counts for this session.',
      icon: Coins,
    },
    status: {
      eyebrow: 'Runtime health',
      title: 'System Status',
      subtitle: 'Version, provider, runtime, and environment details in one place.',
      icon: Activity,
    },
    context: {
      eyebrow: 'Session telemetry',
      title: 'Context Window',
      subtitle: 'What is filling this session’s context, measured on its last turn, with your plan limits below.',
      icon: Gauge,
    },
  } as const;

  const activeMeta = kind ? modalMeta[kind] : null;
  const HeaderIcon = activeMeta?.icon || Sparkles;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl sm:w-[min(94vw,64rem)]">
        <DialogTitle>{activeMeta?.title || 'Command Result'}</DialogTitle>

        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b border-border bg-popover ${
            isModelsModal ? 'px-4 py-3 sm:px-5 sm:py-4' : 'px-4 py-4 sm:px-6 sm:py-5'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground ${
                isModelsModal ? 'h-9 w-9' : 'h-10 w-10'
              }`}
            >
              <HeaderIcon className={isModelsModal ? 'h-4 w-4' : 'h-5 w-5'} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {activeMeta?.eyebrow}
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {activeMeta?.title}
              </p>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-muted-foreground">
                {activeMeta?.subtitle}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close command result modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="settings-content-enter min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          {payload?.kind === 'help' && <HelpContent data={payload.data as HelpCommandData} />}
          {payload?.kind === 'models' && (
            <ModelsContent
              data={payload.data as ModelCommandData}
              providerModelCatalog={providerModelCatalog}
              providerModelsRefreshing={providerModelsRefreshing}
              onHardRefreshProviderModels={onHardRefreshProviderModels}
              currentSessionId={currentSessionId}
              onSelectProviderModel={onSelectProviderModel}
            />
          )}
          {payload?.kind === 'usage' && <UsageContent data={payload.data as UsageCommandData} />}
          {payload?.kind === 'status' && <StatusContent data={payload.data as StatusCommandData} />}
          {payload?.kind === 'context' && (
            <ContextContent
              data={payload.data as ContextCommandData}
              onShowUsage={onShowUsage}
              onRefresh={onRefreshContext}
              isRefreshing={Boolean(isRefreshingContext)}
              canRefresh={Boolean(isSessionProcessing)}
            />
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            <span>Esc closes the modal.</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
