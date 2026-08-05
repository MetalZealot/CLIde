import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';

import { cn } from '../../../../lib/utils';

type SidebarRepositoryGroupProps = {
  repositoryName: string;
  checkoutCount: number;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  t: TFunction;
};

/**
 * Header for a repository with two or more registered checkouts (ADR 0016).
 *
 * Renders only for genuine groups — the list emits single-checkout projects
 * without one — so this never adds depth to an ordinary project.
 */
export default function SidebarRepositoryGroup({
  repositoryName,
  checkoutCount,
  isCollapsed,
  onToggle,
  children,
  t,
}: SidebarRepositoryGroupProps) {
  return (
    <div className="md:space-y-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 md:px-2',
          'text-left text-xs font-medium text-muted-foreground',
          'transition-colors hover:text-foreground',
        )}
        title={t('projects.repositoryCheckouts', { count: checkoutCount })}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        )}
        <GitBranch className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{repositoryName}</span>
        <span className="flex-shrink-0 opacity-60">
          {t('projects.repositoryCheckouts', { count: checkoutCount })}
        </span>
      </button>

      {/* A single step of indent for the whole group: sessions keep their own
          spacing relative to their checkout, so nesting stays readable on a
          phone rather than adding a full level per tier. */}
      {!isCollapsed && (
        <div className="ml-2 border-l border-border/50 pl-1 md:ml-1.5">{children}</div>
      )}
    </div>
  );
}
