import { useRef, useState } from 'react';
import { Check, ChevronDown, Folder } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { RepositoryEntry } from '../../types/types';

type SidebarProjectPickerProps = {
  entries: RepositoryEntry[];
  selectedEntryKey: string | null;
  onSelect: (entryKey: string | null) => void;
  t: TFunction;
};

/**
 * Repository-row scope for the Projects section.
 *
 * The choices are repository entries rather than raw project rows so linked
 * worktrees never reappear as unrelated top-level projects (ADR 0016). This
 * filter deliberately does not govern Activity or Pinned: both are global
 * navigation and Activity must keep surfacing work that needs attention.
 */
export default function SidebarProjectPicker({ entries, selectedEntryKey, onSelect, t }: SidebarProjectPickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedEntry = entries.find((entry) => entry.key === selectedEntryKey) ?? null;
  // The section label is also the selected value: repeating "Projects" on the
  // left and the repository name on the right scatters one piece of context.
  const selectedLabel = selectedEntry?.displayName ?? t('projects.title');

  const choose = (entryKey: string | null) => {
    onSelect(entryKey);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={entries.length === 0}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          'flex min-h-11 w-full items-center gap-1.5 px-3 md:min-h-0 md:px-2 md:pb-1 md:pt-2',
          'text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70',
          'transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground/70',
        )}
      >
        <Folder className="h-3 w-3 flex-shrink-0" />
        <span className="truncate" title={selectedLabel}>
          {selectedLabel}
        </span>
        {entries.length > 0 && (
          <ChevronDown className={cn('h-3 w-3 flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
        )}
      </button>

      {isOpen && buttonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          onDismiss={() => setIsOpen(false)}
          ariaLabel={t('projects.chooseProject', 'Choose project')}
          className="sidebar-context-menu max-h-[min(70vh,28rem)] min-w-52 max-w-72 overflow-y-auto rounded-xl py-1"
          measureKey={`${entries.length}:${selectedEntryKey ?? 'all'}`}
        >
          <button
            type="button"
            role="menuitem"
            aria-current={selectedEntryKey === null ? 'true' : undefined}
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
              {selectedEntryKey === null && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span className={cn('truncate', selectedEntryKey === null && 'font-medium')}>
              {t('projects.allProjects', 'All projects')}
            </span>
          </button>

          <div className="my-1 border-t border-border" />

          {entries.map((entry) => {
            const isSelected = entry.key === selectedEntryKey;
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => choose(entry.key)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className={cn('truncate', isSelected && 'font-medium')}>{entry.displayName}</span>
              </button>
            );
          })}
        </ContextMenuOverlay>
      )}
    </>
  );
}
