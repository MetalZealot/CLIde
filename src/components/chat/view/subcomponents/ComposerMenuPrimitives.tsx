import type { ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

/**
 * The one popover surface every composer control renders into. `role="dialog"` and
 * `fillAnchorWidth` exist for the usage popover, which is a reading surface rather
 * than a list and wants a stable width instead of shrinking to its content.
 */
export function ComposerMenuSurface({
  anchor,
  menuRef,
  ariaLabel,
  children,
  id,
  role = 'menu',
  className,
  fillAnchorWidth = false,
}: {
  anchor: ComposerMenuAnchor;
  menuRef: Ref<HTMLDivElement>;
  ariaLabel: string;
  children: ReactNode;
  id?: string;
  role?: 'menu' | 'dialog';
  className?: string;
  fillAnchorWidth?: boolean;
}) {
  return (
    <div
      id={id}
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      className={cn(
        'fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl',
        className,
      )}
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        maxHeight: anchor.maxHeight,
        ...(fillAnchorWidth
          ? { width: anchor.maxWidth }
          : { minWidth: Math.min(12 * 16, anchor.maxWidth), maxWidth: anchor.maxWidth }),
      }}
    >
      {children}
    </div>
  );
}

export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">{children}</p>;
}

export function ComposerMenuSeparator() {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}

export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  trailing,
  className,
  disabled = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitem';
  trailing?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-60',
        isSelected ? 'text-foreground' : 'text-foreground/90',
        className,
      )}
    >
      {icon && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>}
      </span>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {trailing ?? (isSelected ? <Check className="h-3.5 w-3.5 text-foreground" /> : null)}
      </span>
    </button>
  );
}
