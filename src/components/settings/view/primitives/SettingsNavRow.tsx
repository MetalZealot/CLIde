import { ChevronRight } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../../../../lib/utils';

type SettingsNavRowProps = {
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Trailing preview of the current value, or a count such as "3 configured". */
  value?: string;
  /** Richer trailing content than `value` — a status dot, a badge. */
  trailing?: ReactNode;
  onClick: () => void;
  isActive?: boolean;
  className?: string;
};

/**
 * The drill-down affordance: a row that pushes another screen. On desktop the
 * same component serves as a rail entry, where `isActive` marks the selection.
 */
export default function SettingsNavRow({
  label,
  description,
  icon: Icon,
  value,
  trailing,
  onClick,
  isActive,
  className,
}: SettingsNavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full touch-manipulation items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 active:bg-accent/50',
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>

      {value && (
        <span className="max-w-[40%] flex-shrink-0 truncate text-sm text-muted-foreground">
          {value}
        </span>
      )}

      {trailing}

      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </button>
  );
}
