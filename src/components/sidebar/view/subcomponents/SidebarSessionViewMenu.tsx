import { ArrowDownAZ, ArrowDownWideNarrow, ArrowUpWideNarrow, Check, RotateCcw, TreeDeciduous } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { RepositoryEntry, RepositoryViewOptions, SessionSortKey } from '../../types/types';
import { getCheckoutRefLabel, isDefaultRepositoryView, isDiscoveredCheckout } from '../../utils/utils';

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

  const sortChoices: Array<{ key: SessionSortKey; label: string; icon: LucideIcon }> = [
    {
      key: 'recent',
      label: t('sessionView.sortNewest', 'Newest first'),
      icon: ArrowDownWideNarrow,
    },
    {
      key: 'oldest',
      label: t('sessionView.sortOldest', 'Oldest first'),
      icon: ArrowUpWideNarrow,
    },
    {
      key: 'title',
      label: t('sessionView.sortTitle', 'Session title'),
      icon: ArrowDownAZ,
    },
    ...(isMerged
      ? [
          {
            key: 'worktree' as const,
            label: t('sessionView.sortWorktree', 'Worktree'),
            icon: TreeDeciduous,
          },
        ]
      : []),
  ];

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
      {sortChoices.map((choice) => (
        <MenuChoice
          key={choice.key}
          label={choice.label}
          icon={choice.icon}
          isSelected={options.sort === choice.key}
          onSelect={() => onChange({ ...options, sort: choice.key })}
        />
      ))}

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
