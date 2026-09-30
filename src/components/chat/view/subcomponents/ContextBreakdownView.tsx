import React from 'react';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { READING_SURFACE_MAX_HEIGHT } from '../../../../shared/view/ui';
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

const formatReadingAge = (fetchedAt: number | undefined, t: TFunction): string | null => {
  if (!fetchedAt) return null;

  const minutes = Math.round((Date.now() - fetchedAt) / 60_000);
  if (minutes < 1) return t('contextBreakdown.measuredJustNow', { defaultValue: 'Measured just now' });
  if (minutes < 60) {
    return t('contextBreakdown.measuredMinutesAgo', { defaultValue: 'Measured {{count}} min ago', count: minutes });
  }

  const hours = Math.round(minutes / 60);
  return hours < 24
    ? t('contextBreakdown.measuredHoursAgo', { defaultValue: 'Measured {{count}} h ago', count: hours })
    : t('contextBreakdown.measuredDaysAgo', {
        defaultValue: 'Measured {{count}} d ago',
        count: Math.round(hours / 24),
      });
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
  totalLabel,
}: {
  title: string;
  entries: BreakdownEntry[];
  total?: number;
  totalLabel?: string;
}) {
  const { t } = useTranslation('common');
  if (entries.length === 0) return null;

  return (
    <section className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h3>
        <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('contextBreakdown.tokensUnit', { defaultValue: 'tokens' })}
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
          <span className="text-foreground">
            {totalLabel ?? t('contextBreakdown.total', { defaultValue: 'Total' })}
          </span>
          <span className="shrink-0 font-mono text-foreground">{formatNumber(total)}</span>
        </div>
      )}
    </section>
  );
}

export default function ContextBreakdownView({
  data,
  loading,
  cap,
  onBack,
  onRefresh,
  isRefreshing,
  canRefresh,
}: {
  data: ContextCommandData | null;
  loading: boolean;
  /** A configured auto-compact cap that shrinks the model's own window. */
  cap?: { cap: number; modelWindow: number };
  /** Omitted when the breakdown is expanded in place and owns no header. */
  onBack?: () => void;
  onRefresh?: () => void;
  isRefreshing: boolean;
  canRefresh: boolean;
}) {
  const { t } = useTranslation('common');
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
        { key: 'user', label: t('contextBreakdown.yourMessages', { defaultValue: 'Your messages' }), tokens: messages.userMessageTokens },
        { key: 'assistant', label: t('contextBreakdown.replies', { defaultValue: 'Replies' }), tokens: messages.assistantMessageTokens },
        { key: 'toolCalls', label: t('contextBreakdown.toolCalls', { defaultValue: 'Tool calls' }), tokens: messages.toolCallTokens },
        { key: 'toolResults', label: t('contextBreakdown.toolResults', { defaultValue: 'Tool results' }), tokens: messages.toolResultTokens },
        { key: 'attachments', label: t('contextBreakdown.attachments', { defaultValue: 'Attachments' }), tokens: messages.attachmentTokens },
        { key: 'redirected', label: t('contextBreakdown.redirectedContext', { defaultValue: 'Redirected context' }), tokens: messages.redirectedContextTokens },
        { key: 'unattributed', label: t('contextBreakdown.unattributed', { defaultValue: 'Unattributed' }), tokens: messages.unattributedTokens },
      ].filter((entry) => entry.tokens > 0)
    : [];
  const named = (entries: ContextNamedTokens[] | undefined, prefix: string): BreakdownEntry[] => (
    (entries ?? [])
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({ key: `${prefix}-${entry.name}`, label: entry.name, tokens: entry.tokens }))
  );
  const readingAge = formatReadingAge(data?.fetchedAt, t);
  const refreshLabel = t('contextBreakdown.refresh', { defaultValue: 'Refresh session breakdown' });

  return (
    <div className="space-y-3">
      <div className={onBack ? 'flex items-center justify-between gap-3' : 'flex items-center justify-end'}>
        {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          {t('contextBreakdown.title', { defaultValue: 'Session breakdown' })}
        </button>
        )}
        {readingAge && (
          <span className="ml-auto mr-2 shrink-0 text-[11px] text-muted-foreground">{readingAge}</span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing || !canRefresh}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            aria-label={refreshLabel}
            title={canRefresh
              ? refreshLabel
              : t('contextBreakdown.refreshUnavailable', {
                  defaultValue: 'The reading only updates while a turn is streaming',
                })}
          >
            <RefreshCw className={isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          </button>
        )}
      </div>

      {/* Eleven sections is long by nature, so the reading area scrolls and the
          back button and refresh stay put. */}
      <div className="space-y-3 overflow-y-auto overscroll-contain" style={{ maxHeight: READING_SURFACE_MAX_HEIGHT }}>
      {cap && (
        <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
          {t('contextBreakdown.autoCompactCap', {
            defaultValue: "Auto-compact capped at {{cap}} of the model's {{window}} window.",
            cap: formatNumber(cap.cap),
            window: formatNumber(cap.modelWindow),
          })}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t('contextBreakdown.loading', { defaultValue: 'Loading session breakdown…' })}
        </p>
      )}

      {!loading && !breakdown && (
        <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
          {data?.message || t('contextBreakdown.empty', {
            defaultValue: 'Complete a turn in this session to record its context breakdown.',
          })}
        </p>
      )}

      {!loading && breakdown && (
        <>
          <BreakdownSection
            title={t('contextBreakdown.inWindow', { defaultValue: 'What is in the window' })}
            entries={spent.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
            total={spentTotal}
          />
          <BreakdownSection
            title={t('contextBreakdown.reserved', { defaultValue: 'Reserved' })}
            entries={[
              { key: 'in-use', label: t('contextBreakdown.inUse', { defaultValue: 'In use (listed above)' }), tokens: spentTotal },
              ...reserved.map((category) => ({
                key: category.name,
                label: category.name,
                hint: !compactsAutomatically
                  ? undefined
                  : isAutoCompactBuffer(category.name)
                    ? t('contextBreakdown.neverUsable', {
                        defaultValue: 'Never usable — above the {{threshold}} threshold',
                        threshold: formatNumber(threshold),
                      })
                    : t('contextBreakdown.roomLeft', { defaultValue: 'Room left before auto-compact fires' }),
                tokens: category.tokens,
              })),
            ]}
            total={maxTokens > 0 && windowTotal === maxTokens ? maxTokens : undefined}
            totalLabel={t('contextBreakdown.contextWindow', { defaultValue: 'Context window' })}
          />
          <BreakdownSection
            title={t('contextBreakdown.deferred', { defaultValue: 'Not counted — loaded on demand' })}
            entries={deferred.map((category) => ({
              key: category.name,
              label: category.name,
              tokens: category.tokens,
            }))}
          />
          <BreakdownSection
            title={t('contextBreakdown.messages', { defaultValue: 'Messages' })}
            entries={messageEntries}
          />
          <BreakdownSection
            title={t('contextBreakdown.attachments', { defaultValue: 'Attachments' })}
            entries={named(messages?.attachmentsByType, 'attachment')}
          />
          <BreakdownSection
            title={t('contextBreakdown.memoryFiles', { defaultValue: 'Memory files' })}
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
            title={t('contextBreakdown.mcpTools', { defaultValue: 'MCP tools' })}
            entries={(breakdown.mcpTools ?? [])
              .filter((tool) => tool.tokens > 0)
              .map((tool) => ({
                key: `${tool.serverName ?? ''}-${tool.name}`,
                label: tool.name,
                hint: tool.serverName,
                tokens: tool.tokens,
              }))}
          />
          <BreakdownSection
            title={t('contextBreakdown.systemTools', { defaultValue: 'System tools' })}
            entries={named(breakdown.systemTools, 'tool')}
          />
          <BreakdownSection
            title={t('contextBreakdown.systemPrompt', { defaultValue: 'System prompt' })}
            entries={named(breakdown.systemPromptSections, 'prompt')}
          />
          <BreakdownSection
            title={t('contextBreakdown.agents', { defaultValue: 'Agents' })}
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
              title={t('contextBreakdown.startupLoaded', { defaultValue: 'Loaded on startup — already counted' })}
              entries={[
                ...(breakdown.skills
                  ? [{
                      key: 'skills',
                      label: t('contextBreakdown.skillsLabel', {
                        defaultValue: 'Skills ({{included}} of {{total}})',
                        included: breakdown.skills.includedSkills,
                        total: breakdown.skills.totalSkills,
                      }),
                      hint: t('contextBreakdown.skillsHint', { defaultValue: 'Listed above as Skills' }),
                      tokens: breakdown.skills.tokens,
                    }]
                  : []),
                ...(breakdown.slashCommands
                  ? [{
                      key: 'commands',
                      label: t('contextBreakdown.slashCommandsLabel', {
                        defaultValue: 'Slash commands ({{included}} of {{total}})',
                        included: breakdown.slashCommands.includedCommands,
                        total: breakdown.slashCommands.totalCommands,
                      }),
                      hint: t('contextBreakdown.slashCommandsHint', { defaultValue: 'Part of the system prompt' }),
                      tokens: breakdown.slashCommands.tokens,
                    }]
                  : []),
              ].filter((entry) => entry.tokens > 0)}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}
