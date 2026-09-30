import React, { useState } from 'react';
import { ChevronDown, ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { READING_SURFACE_MAX_HEIGHT } from '../../../../shared/view/ui';
import { formatCompactTokens } from '../../utils/chatFormatting';
import type { ContextCommandData, ContextNamedTokens } from '../../hooks/useChatComposerState';

type Category = NonNullable<NonNullable<ContextCommandData['breakdown']>['categories']>[number];

type DetailEntry = {
  key: string;
  label: string;
  hint?: string;
  tokens: number;
};

// Categorical slots from the dataviz reference palette, validated in both themes for
// this adjacency. A slot follows the category, never its rank; unknown names share "other".
const CATEGORY_SLOTS: Array<{ match: RegExp; swatch: string }> = [
  { match: /^messages/i, swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  { match: /memory/i, swatch: 'bg-[#eb6834] dark:bg-[#d95926]' },
  { match: /system tools/i, swatch: 'bg-[#1baf7a] dark:bg-[#199e70]' },
  { match: /skill/i, swatch: 'bg-[#eda100] dark:bg-[#c98500]' },
  { match: /system prompt/i, swatch: 'bg-[#e87ba4] dark:bg-[#d55181]' },
  { match: /mcp/i, swatch: 'bg-[#008300] dark:bg-[#008300]' },
  { match: /agent/i, swatch: 'bg-[#4a3aa7] dark:bg-[#9085e9]' },
];
const OTHER_SWATCH = 'bg-[#e34948] dark:bg-[#e66767]';

const slotIndex = (name: string): number => {
  const index = CATEGORY_SLOTS.findIndex((slot) => slot.match.test(name));
  return index === -1 ? CATEGORY_SLOTS.length : index;
};

const swatchFor = (name: string): string => CATEGORY_SLOTS[slotIndex(name)]?.swatch ?? OTHER_SWATCH;

const isFreeSpace = (name: string): boolean => /free space/i.test(name);

const isReservedCategory = (name: string): boolean => (
  isFreeSpace(name) || /compact/i.test(name)
);

const shortenPath = (value: string): string => {
  const segments = value.split('/').filter(Boolean);
  return segments.length <= 3 ? value : `…/${segments.slice(-3).join('/')}`;
};

const formatShare = (tokens: number, total: number): string => {
  if (total <= 0) return '';
  const percent = (tokens / total) * 100;
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
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

const named = (entries: ContextNamedTokens[] | undefined, prefix: string): DetailEntry[] => (
  (entries ?? [])
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({ key: `${prefix}-${entry.name}`, label: entry.name, tokens: entry.tokens }))
);

function DetailList({ entries }: { entries: DetailEntry[] }) {
  return (
    <div className="space-y-1 pb-2 pl-[1.125rem]">
      {entries.map((entry) => (
        <div key={entry.key} className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-xs text-muted-foreground" title={entry.label}>
              {entry.label}
            </span>
            {entry.hint && (
              <span className="block truncate text-[11px] text-muted-foreground/70" title={entry.hint}>
                {entry.hint}
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatCompactTokens(entry.tokens)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One legend row; opens in place when the category has an itemised list. */
function CategoryRow({
  label,
  swatch,
  tokens,
  share,
  details,
}: {
  label: string;
  swatch?: string;
  tokens: number;
  share?: string;
  details: DetailEntry[];
}) {
  const [open, setOpen] = useState(false);
  const expandable = details.length > 0;
  const content = (
    <>
      <span
        className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', swatch ?? 'border border-muted-foreground/50')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-left text-sm text-foreground">{label}</span>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatCompactTokens(tokens)}</span>
      {/* Fixed-width columns so shares and chevrons align across rows. */}
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{share}</span>
      <span className="grid w-3.5 shrink-0 place-items-center text-muted-foreground">
        {expandable && (
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        )}
      </span>
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-9 w-full items-center gap-2 rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-h-9 items-center gap-2">{content}</div>
      )}
      {open && <DetailList entries={details} />}
    </div>
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
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing: boolean;
  canRefresh: boolean;
}) {
  const { t } = useTranslation('common');
  const breakdown = data?.breakdown;
  const categories = (breakdown?.categories ?? []).filter((category) => category.tokens > 0);
  const spent = categories
    .filter((category) => !category.isDeferred && !isReservedCategory(category.name))
    .sort((left, right) => slotIndex(left.name) - slotIndex(right.name));
  const buffers = categories.filter((category) => (
    !category.isDeferred && isReservedCategory(category.name) && !isFreeSpace(category.name)
  ));
  const deferred = categories.filter((category) => category.isDeferred);
  const spentTotal = spent.reduce((sum, category) => sum + category.tokens, 0);
  const deferredTotal = deferred.reduce((sum, category) => sum + category.tokens, 0);

  const messages = breakdown?.messageBreakdown;
  const messageDetails: DetailEntry[] = messages
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
  const attachmentDetails = named(messages?.attachmentsByType, 'attachment').map((entry) => ({
    ...entry,
    hint: t('contextBreakdown.attachmentHint', { defaultValue: 'Attachment' }),
  }));
  const mcpTools = (breakdown?.mcpTools ?? []).filter((tool) => tool.tokens > 0);
  const toMcpDetail = (tool: (typeof mcpTools)[number]): DetailEntry => ({
    key: `${tool.serverName ?? ''}-${tool.name}`,
    label: tool.name,
    hint: tool.serverName,
    tokens: tool.tokens,
  });
  const slashCommands = breakdown?.slashCommands;

  const detailsFor = (category: Category): DetailEntry[] => {
    const name = category.name;
    if (/^messages/i.test(name)) return [...messageDetails, ...attachmentDetails];
    if (/memory/i.test(name)) {
      return (breakdown?.memoryFiles ?? [])
        .filter((file) => file.tokens > 0)
        .map((file) => ({
          key: file.path,
          label: file.type
            ? `${file.path.split('/').pop() || file.path} — ${file.type}`
            : file.path.split('/').pop() || file.path,
          hint: shortenPath(file.path),
          tokens: file.tokens,
        }));
    }
    if (/system tools/i.test(name)) return named(breakdown?.systemTools, 'tool');
    if (/skill/i.test(name) && breakdown?.skills) {
      return [{
        key: 'skills',
        label: t('contextBreakdown.skillsLabel', {
          defaultValue: 'Skills ({{included}} of {{total}})',
          included: breakdown.skills.includedSkills,
          total: breakdown.skills.totalSkills,
        }),
        tokens: breakdown.skills.tokens,
      }];
    }
    if (/system prompt/i.test(name)) {
      return [
        ...named(breakdown?.systemPromptSections, 'prompt'),
        ...(slashCommands && slashCommands.tokens > 0
          ? [{
              key: 'commands',
              label: t('contextBreakdown.slashCommandsLabel', {
                defaultValue: 'Slash commands ({{included}} of {{total}})',
                included: slashCommands.includedCommands,
                total: slashCommands.totalCommands,
              }),
              tokens: slashCommands.tokens,
            }]
          : []),
      ];
    }
    if (/mcp/i.test(name)) return mcpTools.filter((tool) => tool.isLoaded !== false).map(toMcpDetail);
    if (/agent/i.test(name)) {
      return (breakdown?.agents ?? [])
        .filter((agent) => agent.tokens > 0)
        .map((agent) => ({ key: agent.name, label: agent.name, hint: agent.source, tokens: agent.tokens }));
    }
    return [];
  };

  const deferredDetails: DetailEntry[] = [
    ...deferred.map((category) => ({ key: category.name, label: category.name, tokens: category.tokens })),
    ...mcpTools.filter((tool) => tool.isLoaded === false).map(toMcpDetail),
  ];
  const readingAge = formatReadingAge(data?.fetchedAt, t);
  const refreshLabel = t('contextBreakdown.refresh', { defaultValue: 'Refresh session breakdown' });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-7 min-w-0 items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          {t('contextBreakdown.title', { defaultValue: 'Context breakdown' })}
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {readingAge && <span className="text-[11px] text-muted-foreground">{readingAge}</span>}
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
        </span>
      </div>

      {/* The rows scroll under a fixed back button and refresh. */}
      <div className="space-y-3 overflow-y-auto overscroll-contain" style={{ maxHeight: READING_SURFACE_MAX_HEIGHT }}>
        {loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('contextBreakdown.loading', { defaultValue: 'Loading context breakdown…' })}
          </p>
        )}

        {!loading && !breakdown && (
          <p className="text-xs leading-5 text-muted-foreground">
            {data?.message || t('contextBreakdown.empty', {
              defaultValue: 'Complete a turn in this session to record its context breakdown.',
            })}
          </p>
        )}

        {!loading && breakdown && (
          <>
            <section className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {t('contextBreakdown.inUseHeadline', {
                  defaultValue: '{{tokens}} in use',
                  tokens: formatCompactTokens(spentTotal),
                })}
              </p>
              {spentTotal > 0 && (
                <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                  {spent.map((category) => (
                    <span
                      key={category.name}
                      className={cn('h-full min-w-[2px]', swatchFor(category.name))}
                      style={{ flexGrow: category.tokens, flexBasis: 0 }}
                      title={`${category.name}: ${formatCompactTokens(category.tokens)}`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              {spent.map((category) => (
                <CategoryRow
                  key={category.name}
                  label={category.name}
                  swatch={swatchFor(category.name)}
                  tokens={category.tokens}
                  share={formatShare(category.tokens, spentTotal)}
                  details={detailsFor(category)}
                />
              ))}
              {deferredTotal > 0 && (
                <CategoryRow
                  label={t('contextBreakdown.deferredRow', { defaultValue: 'Loaded on demand, not counted' })}
                  tokens={deferredTotal}
                  details={deferredDetails}
                />
              )}
            </section>

            {(buffers.length > 0 || cap) && (
              <div className="space-y-1 border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">
                {buffers.length > 0 && (
                  <p>
                    {t('contextBreakdown.alsoReserved', {
                      defaultValue: 'Also reserved: {{items}}',
                      items: buffers
                        .map((category) => `${formatCompactTokens(category.tokens)} ${category.name.toLowerCase()}`)
                        .join(', '),
                    })}
                  </p>
                )}
                {cap && (
                  <p>
                    {t('contextBreakdown.autoCompactCap', {
                      defaultValue: "Auto-compact capped at {{cap}} of the model's {{window}} window.",
                      cap: formatCompactTokens(cap.cap),
                      window: formatCompactTokens(cap.modelWindow),
                    })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
