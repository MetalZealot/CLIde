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
 * The one set of metrics every sidebar section label uses.
 *
 * Exported because the Projects label is a menu button rather than a section
 * toggle (`SidebarProjectPicker`) and so cannot render through this component.
 * It previously carried its own `min-h-11`, which made the same visual element
 * 44px tall next to Pinned's 16px — the headers read as inconsistent because
 * they were, and none of the three matched.
 *
 * The padding is deliberately asymmetric: a label an equal distance from the
 * block above and the block below binds to neither. Anything placed in the
 * `summary` slot must not grow this box (see the `-my-1` on the Sessions
 * controls), or that header alone gains centred padding the others lack.
 */
export const SIDEBAR_SECTION_HEADER_CLASS = cn(
  'flex w-full items-center gap-1.5 px-3 pb-0.5 pt-3 md:px-2 md:pb-0 md:pt-2',
  'text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70',
);

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

  const className = SIDEBAR_SECTION_HEADER_CLASS;

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
