import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  Folder,
  RotateCcw,
  Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';
import type {
  BrowseSessionSortKey,
  BrowseSessionViewOptions,
  ProjectSortOrder,
  ProjectViewOptions,
  RepositoryEntry,
  SidebarBrowseMode,
  SessionSortDirection,
} from '../../types/types';
import {
  getCheckoutRefLabel,
  isDefaultBrowseSessionView,
  isDefaultProjectView,
  isDiscoveredCheckout,
} from '../../utils/utils';

type SidebarBrowseFilterMenuProps = {
  anchor: ContextMenuAnchor;
  browseMode: SidebarBrowseMode;
  repositoryEntries: RepositoryEntry[];
  projectOptions: ProjectViewOptions;
  sessionOptions: BrowseSessionViewOptions;
  onProjectChange: (options: ProjectViewOptions) => void;
  onSessionChange: (options: BrowseSessionViewOptions) => void;
  onProjectReset: () => void;
  onSessionReset: () => void;
  onClose: () => void;
  t: TFunction;
};

const defaultDirection = {
  name: 'asc',
  date: 'desc',
  title: 'asc',
  project: 'asc',
} satisfies Record<ProjectSortOrder | BrowseSessionSortKey, SessionSortDirection>;

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function SortChoice({
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
      {isSelected && <span className="text-[11px] text-muted-foreground">{orderLabel}</span>}
    </button>
  );
}

export default function SidebarBrowseFilterMenu({
  anchor,
  browseMode,
  repositoryEntries,
  projectOptions,
  sessionOptions,
  onProjectChange,
  onSessionChange,
  onProjectReset,
  onSessionReset,
  onClose,
  t,
}: SidebarBrowseFilterMenuProps) {
  const isProjects = browseMode === 'projects';
  const alphabetical = {
    asc: t('sessionView.orderAZ', 'A–Z'),
    desc: t('sessionView.orderZA', 'Z–A'),
  };
  const dateOrder = {
    asc: t('sessionView.orderOldestFirst', 'Oldest first'),
    desc: t('sessionView.orderNewestFirst', 'Newest first'),
  };
  const sortChoices = isProjects
    ? [
        { key: 'name' as const, label: t('browseView.sortName', 'Name'), icon: Type, order: alphabetical },
        { key: 'date' as const, label: t('browseView.sortDate', 'Date'), icon: CalendarClock, order: dateOrder },
      ]
    : [
        { key: 'date' as const, label: t('sessionView.sortDate', 'Date'), icon: CalendarClock, order: dateOrder },
        { key: 'title' as const, label: t('sessionView.sortTitle', 'Session title'), icon: Type, order: alphabetical },
        { key: 'project' as const, label: t('browseView.sortProject', 'Project'), icon: Folder, order: alphabetical },
      ];
  const selectedSort = isProjects ? projectOptions.sort : sessionOptions.sort;
  const selectedDirection = isProjects ? projectOptions.direction : sessionOptions.direction;
  const filterableCheckouts = repositoryEntries.flatMap((entry) => {
    const registered = entry.checkouts.filter((checkout) => !isDiscoveredCheckout(checkout));
    return registered.map((checkout) => ({
      projectId: checkout.projectId,
      label: registered.length > 1
        ? `${entry.displayName} · ${getCheckoutRefLabel(checkout) ?? checkout.displayName ?? checkout.projectId}`
        : entry.displayName,
    }));
  });
  const isCustomized = isProjects
    ? !isDefaultProjectView(projectOptions)
    : !isDefaultBrowseSessionView(sessionOptions);

  const selectSort = (key: ProjectSortOrder | BrowseSessionSortKey) => {
    if (isProjects) {
      const projectKey = key as ProjectSortOrder;
      const direction = projectOptions.sort === projectKey
        ? projectOptions.direction === 'asc' ? 'desc' : 'asc'
        : defaultDirection[projectKey];
      onProjectChange({ sort: projectKey, direction });
      return;
    }

    const sessionKey = key as BrowseSessionSortKey;
    const direction = sessionOptions.sort === sessionKey
      ? sessionOptions.direction === 'asc' ? 'desc' : 'asc'
      : defaultDirection[sessionKey];
    onSessionChange({ ...sessionOptions, sort: sessionKey, direction });
  };

  const toggleCheckout = (projectId: string) => {
    const allIds = filterableCheckouts.map((checkout) => checkout.projectId);
    const current = sessionOptions.checkoutProjectIds ?? allIds;
    const next = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];
    onSessionChange({
      ...sessionOptions,
      checkoutProjectIds: next.length === allIds.length ? null : next,
    });
  };

  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onClose}
      ariaLabel={isProjects
        ? t('browseView.projectOptions', 'Sort projects')
        : t('browseView.sessionOptions', 'Sort and filter sessions')}
      className="sidebar-context-menu max-h-[min(70vh,32rem)] min-w-56 max-w-72 overflow-y-auto rounded-xl py-1"
      measureKey={`${browseMode}:${sortChoices.length}:${filterableCheckouts.length}:${isCustomized}`}
    >
      <SectionLabel>{t('sessionView.sortBy', 'Sort by')}</SectionLabel>
      {sortChoices.map((choice) => {
        const direction = selectedSort === choice.key
          ? selectedDirection
          : defaultDirection[choice.key];
        return (
          <SortChoice
            key={choice.key}
            label={choice.label}
            orderLabel={choice.order[direction]}
            icon={choice.icon}
            isSelected={selectedSort === choice.key}
            direction={direction}
            onSelect={() => selectSort(choice.key)}
          />
        );
      })}

      {!isProjects && filterableCheckouts.length > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <SectionLabel>{t('browseView.filterProjectWorktree', 'Filter by project / worktree')}</SectionLabel>
          {filterableCheckouts.map((checkout) => {
            const isSelected = sessionOptions.checkoutProjectIds === null
              || sessionOptions.checkoutProjectIds.includes(checkout.projectId);
            return (
              <button
                key={checkout.projectId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={isSelected}
                onClick={() => toggleCheckout(checkout.projectId)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate">{checkout.label}</span>
              </button>
            );
          })}
        </>
      )}

      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        disabled={!isCustomized}
        onClick={() => {
          if (isProjects) onProjectReset();
          else onSessionReset();
          onClose();
        }}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
          isCustomized
            ? 'text-foreground hover:bg-accent active:bg-accent'
            : 'cursor-default text-muted-foreground/50',
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <RotateCcw className="h-3.5 w-3.5" />
        </span>
        {t('sessionView.reset', 'Reset')}
      </button>
    </ContextMenuOverlay>
  );
}
