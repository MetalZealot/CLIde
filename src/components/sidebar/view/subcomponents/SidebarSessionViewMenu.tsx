import { ArrowDown, ArrowUp, CalendarClock, Check, RotateCcw, TreeDeciduous, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type {
  RepositoryEntry,
  RepositoryViewOptions,
  SessionSortDirection,
  SessionSortKey,
} from '../../types/types';
import {
  DEFAULT_SORT_DIRECTION,
  getCheckoutRefLabel,
  isDefaultRepositoryView,
  isDiscoveredCheckout,
} from '../../utils/utils';

type SidebarSessionViewMenuProps = {
  entry: RepositoryEntry;
  anchor: ContextMenuAnchor;
  options: RepositoryViewOptions;
  onChange: (options: RepositoryViewOptions) => void;
  onReset: () => void;
  onClose: () => void;
  t: TFunction;
};

function MenuSectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
}

/**
 * A menu row that reports its own state. The checkmark is a fixed-width slot
 * rather than a conditional element, so labels line up whether or not the row
 * is the selected one.
 */
function MenuChoice({
  label,
  icon: Icon,
  isSelected,
  onSelect,
}: {
  label: string;
  icon?: LucideIcon;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isSelected}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
      </span>
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
      <span className={cn('truncate', isSelected && 'font-medium')}>{label}</span>
    </button>
  );
}

/**
 * A sort field, which is also its own direction toggle: picking the active field
 * again reverses it. The arrow marks the active field in the slot a checkmark
 * would use, and the order reads out in words because an arrow alone cannot say
 * whether down means newest or oldest.
 */
function MenuSortChoice({
  label,
  orderLabel,
  icon: Icon,
  isSelected,
  direction,
  onSelect,
}: {
  label: string;
  orderLabel: string;
  icon: LucideIcon;
  isSelected: boolean;
  direction: SessionSortDirection;
  onSelect: () => void;
}) {
  const Arrow = direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isSelected}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {isSelected && <Arrow className="h-3.5 w-3.5 text-primary" />}
      </span>
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}>{label}</span>
      {isSelected && (
        <span className="flex-shrink-0 text-[11px] text-muted-foreground">{orderLabel}</span>
      )}
    </button>
  );
}

/**
 * Sort and filter for one repository row's session list.
 *
 * Filtering by worktree appears only when the row actually covers several —
 * on a single-checkout project it could only ever be a no-op. Model is
 * deliberately absent: the pick is stored per session but never reaches the
 * session list, so the menu would filter on a field that is empty for almost
 * every row (deferred 2026-08-06, see `docs/TODO.md`).
 */
export default function SidebarSessionViewMenu({
  entry,
  anchor,
  options,
  onChange,
  onReset,
  onClose,
  t,
}: SidebarSessionViewMenuProps) {
  /**
   * Only registered checkouts can be filtered on. A discovered one owns no
   * sessions, so listing it would offer a filter that hides nothing while
   * inflating the count that decides when "all worktrees" collapses to "no
   * filter" — and a row whose second checkout is merely discovered is not a
   * merged row as far as *sessions* are concerned.
   */
  const filterableCheckouts = entry.checkouts.filter((checkout) => !isDiscoveredCheckout(checkout));
  const isMerged = filterableCheckouts.length > 1;
  const isCustomized = !isDefaultRepositoryView(options);

  type SortChoice = {
    key: SessionSortKey;
    label: string;
    icon: LucideIcon;
    order: Record<SessionSortDirection, string>;
  };

  const alphabetical = {
    asc: t('sessionView.orderAZ', 'A–Z'),
    desc: t('sessionView.orderZA', 'Z–A'),
  };

  const sortChoices: SortChoice[] = [
    {
      key: 'date',
      label: t('sessionView.sortDate', 'Date'),
      icon: CalendarClock,
      order: {
        asc: t('sessionView.orderOldestFirst', 'Oldest first'),
        desc: t('sessionView.orderNewestFirst', 'Newest first'),
      },
    },
    {
      key: 'title',
      label: t('sessionView.sortTitle', 'Session title'),
      icon: Type,
      order: alphabetical,
    },
    ...(isMerged
      ? [
          {
            key: 'worktree' as const,
            label: t('sessionView.sortWorktree', 'Worktree'),
            icon: TreeDeciduous,
            order: alphabetical,
          },
        ]
      : []),
  ];

  /** Picking the active field reverses it; picking another starts it its own way up. */
  const selectSort = (key: SessionSortKey) => {
    const direction =
      options.sort === key
        ? options.direction === 'asc'
          ? 'desc'
          : 'asc'
        : DEFAULT_SORT_DIRECTION[key];

    onChange({ ...options, sort: key, direction });
  };

  const worktreeLabel = (checkout: Project) =>
    getCheckoutRefLabel(checkout) ?? checkout.displayName ?? checkout.projectId;

  /**
   * Filtering to every worktree is the same view as filtering to none of them,
   * so it collapses back to "all" — that keeps the header's active-filter
   * highlight honest rather than lit for a filter that hides nothing.
   */
  const toggleWorktree = (projectId: string) => {
    const current = options.worktreeProjectIds ?? filterableCheckouts.map((checkout) => checkout.projectId);
    const next = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];

    if (next.length === 0 || next.length === filterableCheckouts.length) {
      onChange({ ...options, worktreeProjectIds: next.length === 0 ? next : null });
      return;
    }

    onChange({ ...options, worktreeProjectIds: next });
  };

  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onClose}
      ariaLabel={t('sessionView.title', 'Sort and filter sessions')}
      className="sidebar-context-menu min-w-52 max-w-72 overflow-hidden rounded-xl py-1"
      measureKey={`${sortChoices.length}:${entry.checkouts.length}:${isCustomized}`}
    >
      <MenuSectionLabel label={t('sessionView.sortBy', 'Sort by')} />
      {sortChoices.map((choice) => {
        const isSelected = options.sort === choice.key;
        const direction = isSelected ? options.direction : DEFAULT_SORT_DIRECTION[choice.key];

        return (
          <MenuSortChoice
            key={choice.key}
            label={choice.label}
            orderLabel={choice.order[direction]}
            icon={choice.icon}
            isSelected={isSelected}
            direction={direction}
            onSelect={() => selectSort(choice.key)}
          />
        );
      })}

      {isMerged && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuSectionLabel label={t('sessionView.filterByWorktree', 'Filter by worktree')} />
          {filterableCheckouts.map((checkout) => (
            <MenuChoice
              key={checkout.projectId}
              label={worktreeLabel(checkout)}
              isSelected={
                options.worktreeProjectIds === null ||
                options.worktreeProjectIds.includes(checkout.projectId)
              }
              onSelect={() => toggleWorktree(checkout.projectId)}
            />
          ))}
        </>
      )}

      <div className="my-1 border-t border-border" />
      {/*
        Always present, disabled at rest: a reset that appears only once a
        filter is on is a control you have to discover twice.
      */}
      <button
        type="button"
        role="menuitem"
        disabled={!isCustomized}
        onClick={() => {
          onReset();
          onClose();
        }}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
          isCustomized
            ? 'text-foreground hover:bg-accent active:bg-accent'
            : 'cursor-default text-muted-foreground/50',
        )}
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <RotateCcw className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">{t('sessionView.reset', 'Reset')}</span>
      </button>
    </ContextMenuOverlay>
  );
}
