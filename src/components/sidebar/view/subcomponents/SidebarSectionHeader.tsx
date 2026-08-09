import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';

type SidebarSectionHeaderProps = {
  label: string;
  icon?: LucideIcon;
  count?: number;
  summary?: ReactNode;
  /** Omit to render an inert label. */
  isCollapsed?: boolean;
  onToggle?: () => void;
};

/**
 * Small muted divider label above a run of rows ("Pinned", "Projects").
 *
 * Every client in `docs/ui ref/` uses one of these instead of giving sections
 * their own container, so it stays deliberately weightless: no background, no
 * border, and it never looks like something you navigate to.
 */
export default function SidebarSectionHeader({
  label,
  icon: Icon,
  count,
  summary,
  isCollapsed,
  onToggle,
}: SidebarSectionHeaderProps) {
  const content = (
    <>
      {Icon && <Icon className="h-3 w-3 flex-shrink-0" />}
      <span className="truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="flex-shrink-0 tabular-nums opacity-60">{count}</span>
      )}
      {onToggle &&
        (isCollapsed ? (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ))}
      {summary}
    </>
  );

  const className = cn(
    'flex w-full items-center gap-1.5 px-3 pb-1 pt-2 md:px-2',
    'text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70',
  );

  if (!onToggle) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      className={cn(className, 'transition-colors hover:text-foreground')}
    >
      {content}
    </button>
  );
}
