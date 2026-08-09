import React from 'react';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';

import type { ContextCommandData, ContextNamedTokens } from '../../hooks/useChatComposerState';

const formatNumber = (value: number): string => (
  Number.isFinite(value) ? value.toLocaleString() : '0'
);

const isReservedCategory = (name: string): boolean => (
  /free space|autocompact|auto-compact/i.test(name)
);

const isAutoCompactBuffer = (name: string): boolean => (
  /autocompact|auto-compact/i.test(name)
);

const shortenPath = (value: string): string => {
  const segments = value.split('/').filter(Boolean);
  return segments.length <= 3 ? value : `…/${segments.slice(-3).join('/')}`;
};

const formatReadingAge = (fetchedAt: number | undefined): string | null => {
  if (!fetchedAt) return null;

  const minutes = Math.round((Date.now() - fetchedAt) / 60_000);
  if (minutes < 1) return 'Measured just now.';
  if (minutes < 60) return `Measured ${minutes} min ago.`;

  const hours = Math.round(minutes / 60);
  return hours < 24
    ? `Measured ${hours} h ago.`
    : `Measured ${Math.round(hours / 24)} d ago.`;
};

type BreakdownEntry = {
  key: string;
  label: string;
  hint?: string;
  tokens: number;
};

function BreakdownSection({
  title,
  entries,
  total,
  totalLabel = 'Total',
}: {
  title: string;
  entries: BreakdownEntry[];
  total?: number;
  totalLabel?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h3>
        <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
          tokens
        </span>
      </div>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="block truncate text-xs text-foreground" title={entry.label}>
                {entry.label}
              </span>
              {entry.hint && (
                <span className="block truncate text-[11px] text-muted-foreground" title={entry.hint}>
                  {entry.hint}
                </span>
              )}
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {formatNumber(entry.tokens)}
            </span>
          </div>
        ))}
      </div>
      {typeof total === 'number' && (
        <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 text-xs">
          <span className="text-foreground">{totalLabel}</span>
          <span className="shrink-0 font-mono text-foreground">{formatNumber(total)}</span>
        </div>
      )}
    </section>
  );
}

export default function ContextBreakdownView({
  data,
  loading,
  onBack,
  onRefresh,
  isRefreshing,
  canRefresh,
}: {
  data: ContextCommandData | null;
  loading: boolean;
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing: boolean;
  canRefresh: boolean;
}) {
  const breakdown = data?.breakdown;
  const maxTokens = Number(data?.maxTokens ?? 0);
  const threshold = Number(data?.autoCompactThreshold ?? 0);
  const compactsAutomatically = data?.isAutoCompactEnabled === true && threshold > 0;
  const categories = (breakdown?.categories ?? []).filter((category) => category.tokens > 0);
  const counted = categories.filter((category) => !category.isDeferred);
  const spent = counted.filter((category) => !isReservedCategory(category.name));
  const reserved = counted.filter((category) => isReservedCategory(category.name));
  const deferred = categories.filter((category) => category.isDeferred);
  const spentTotal = spent.reduce((sum, category) => sum + category.tokens, 0);
  const windowTotal = spentTotal + reserved.reduce((sum, category) => sum + category.tokens, 0);
  const messages = breakdown?.messageBreakdown;
  const messageEntries: BreakdownEntry[] = messages
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
  const named = (entries: ContextNamedTokens[] | undefined, prefix: string): BreakdownEntry[] => (
    (entries ?? [])
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({ key: `${prefix}-${entry.name}`, label: entry.name, tokens: entry.tokens }))
  );
  const readingAge = formatReadingAge(data?.fetchedAt);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          Session breakdown
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing || !canRefresh}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            aria-label="Refresh session breakdown"
            title={canRefresh ? 'Refresh session breakdown' : 'The reading only updates while a turn is streaming'}
          >
            <RefreshCw className={isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          </button>
        )}
      </div>

      {loading && (
        <p className="flex items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading session breakdown…
        </p>
      )}

      {!loading && !breakdown && (
        <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
          {data?.message || 'Complete a turn in this session to record its context breakdown.'}
        </p>
      )}

      {!loading && breakdown && (
        <>
          <BreakdownSection
            title="What is in the window"
            entries={spent.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
            total={spentTotal}
          />
          <BreakdownSection
            title="Reserved"
            entries={[
              { key: 'in-use', label: 'In use (listed above)', tokens: spentTotal },
              ...reserved.map((category) => ({
                key: category.name,
                label: category.name,
                hint: !compactsAutomatically
                  ? undefined
                  : isAutoCompactBuffer(category.name)
                    ? `Never usable — above the ${formatNumber(threshold)} threshold`
                    : 'Room left before auto-compact fires',
                tokens: category.tokens,
              })),
            ]}
            total={maxTokens > 0 && windowTotal === maxTokens ? maxTokens : undefined}
            totalLabel="Context window"
          />
          <BreakdownSection
            title="Not counted — loaded on demand"
            entries={deferred.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
          />
          <BreakdownSection title="Messages" entries={messageEntries} />
          <BreakdownSection title="Attachments" entries={named(messages?.attachmentsByType, 'attachment')} />
          <BreakdownSection
            title="Memory files"
            entries={(breakdown.memoryFiles ?? [])
              .filter((file) => file.tokens > 0)
              .map((file) => ({
                key: file.path,
                label: file.type
                  ? `${file.path.split('/').pop() || file.path} — ${file.type}`
                  : file.path.split('/').pop() || file.path,
                hint: shortenPath(file.path),
                tokens: file.tokens,
              }))}
          />
          <BreakdownSection
            title="MCP tools"
            entries={(breakdown.mcpTools ?? [])
              .filter((tool) => tool.tokens > 0)
              .map((tool) => ({
                key: `${tool.serverName ?? ''}-${tool.name}`,
                label: tool.name,
                hint: tool.serverName,
                tokens: tool.tokens,
              }))}
          />
          <BreakdownSection title="System tools" entries={named(breakdown.systemTools, 'tool')} />
          <BreakdownSection title="System prompt" entries={named(breakdown.systemPromptSections, 'prompt')} />
          <BreakdownSection
            title="Agents"
            entries={(breakdown.agents ?? [])
              .filter((agent) => agent.tokens > 0)
              .map((agent) => ({
                key: agent.name,
                label: agent.name,
                hint: agent.source,
                tokens: agent.tokens,
              }))}
          />
          {(breakdown.skills || breakdown.slashCommands) && (
            <BreakdownSection
              title="Loaded on startup — already counted"
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
                      hint: 'Part of the system prompt',
                      tokens: breakdown.slashCommands.tokens,
                    }]
                  : []),
              ].filter((entry) => entry.tokens > 0)}
            />
          )}
          {readingAge && <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">{readingAge}</p>}
        </>
      )}
    </div>
  );
}
