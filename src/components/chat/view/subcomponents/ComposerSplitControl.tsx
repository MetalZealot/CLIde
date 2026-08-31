import type { ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '../../../../lib/utils';

interface ComposerSplitControlProps {
  triggerRef?: Ref<HTMLButtonElement>;
  icon: ReactNode;
  label: string;
  onMainClick: () => void;
  mainAriaLabel: string;
  mainTitle: string;
  mainOpensMenu?: boolean;
  menuOpen: boolean;
  onMenuClick: () => void;
  menuAriaLabel: string;
  className?: string;
  mainButtonClassName?: string;
  menuButtonClassName?: string;
}

export default function ComposerSplitControl({
  triggerRef,
  icon,
  label,
  onMainClick,
  mainAriaLabel,
  mainTitle,
  mainOpensMenu = false,
  menuOpen,
  onMenuClick,
  menuAriaLabel,
  className,
  mainButtonClassName,
  menuButtonClassName,
}: ComposerSplitControlProps) {
  return (
    <div className={cn('flex shrink-0 items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={onMainClick}
        className={cn(
          'flex h-8 max-w-28 shrink-0 items-center gap-1 rounded-l-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          mainOpensMenu && menuOpen && 'bg-muted text-foreground',
          mainButtonClassName,
        )}
        aria-haspopup={mainOpensMenu ? 'menu' : undefined}
        aria-expanded={mainOpensMenu ? menuOpen : undefined}
        aria-label={mainAriaLabel}
        title={mainTitle}
      >
        {icon}
        <span className="hidden truncate sm:inline">{label}</span>
      </button>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onMenuClick}
        className={cn(
          'flex h-8 w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          menuOpen && 'bg-muted text-foreground',
          menuButtonClassName,
        )}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={menuAriaLabel}
        title={menuAriaLabel}
      >
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', menuOpen && 'rotate-180')}
          aria-hidden
        />
      </button>
    </div>
  );
}
