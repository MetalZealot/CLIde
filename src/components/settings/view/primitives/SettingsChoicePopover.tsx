import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

import { cn } from '../../../../lib/utils';

const VIEWPORT_PADDING = 10;
const POPOVER_GAP = 8;
const MIN_POPOVER_WIDTH = 220;
const MAX_POPOVER_HEIGHT = 480;

export type SettingsChoiceOption<T extends string> = {
  value: T;
  label: string;
  detail?: string;
};

type SettingsChoicePopoverProps<T extends string> = {
  value: T;
  options: SettingsChoiceOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
};

type PopoverPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/** A select-only popover: current value on the row, complete choices on demand. */
export default function SettingsChoicePopover<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SettingsChoicePopoverProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const selectedOption = options[selectedIndex];

  const close = (restoreFocus = true) => {
    setIsOpen(false);
    setPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const open = (nextActiveIndex = selectedIndex) => {
    setActiveIndex(nextActiveIndex);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const positionPopover = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.min(
        Math.max(triggerRect.width, MIN_POPOVER_WIDTH),
        window.innerWidth - (VIEWPORT_PADDING * 2),
      );
      const spaceBelow = window.innerHeight - triggerRect.bottom - POPOVER_GAP - VIEWPORT_PADDING;
      const spaceAbove = triggerRect.top - POPOVER_GAP - VIEWPORT_PADDING;
      const desiredHeight = Math.min(popover.scrollHeight, MAX_POPOVER_HEIGHT);
      const placeBelow = desiredHeight <= spaceBelow || spaceBelow >= spaceAbove;
      const availableHeight = Math.max(0, placeBelow ? spaceBelow : spaceAbove);
      const maxHeight = Math.min(MAX_POPOVER_HEIGHT, availableHeight);
      const renderedHeight = Math.min(desiredHeight, maxHeight);
      const left = Math.max(
        VIEWPORT_PADDING,
        Math.min(triggerRect.right - width, window.innerWidth - width - VIEWPORT_PADDING),
      );

      setPosition({
        left,
        top: placeBelow
          ? triggerRect.bottom + POPOVER_GAP
          : triggerRect.top - POPOVER_GAP - renderedHeight,
        width,
        maxHeight,
      });
    };

    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.visualViewport?.addEventListener('resize', positionPopover);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.visualViewport?.removeEventListener('resize', positionPopover);
    };
  }, [isOpen, options.length]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`);
    if (activeOption && popoverRef.current?.contains(activeOption)) {
      activeOption.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex, isOpen, listboxId]);

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setActiveIndex((current) => (current + direction + options.length) % options.length);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, options.length - 1));
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, options.length - 1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectIndex(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = window.setTimeout(() => {
        typeaheadRef.current = '';
        typeaheadTimerRef.current = null;
      }, 500);

      const matchIndex = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(typeaheadRef.current));
      if (matchIndex >= 0) {
        event.preventDefault();
        setActiveIndex(matchIndex);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={[ariaLabel, selectedOption?.label, selectedOption?.detail].filter(Boolean).join(', ')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
        onClick={() => isOpen ? close(false) : open()}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex min-h-11 min-w-[10.5rem] touch-manipulation items-center justify-between gap-3 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <span className="min-w-0 truncate font-medium">{selectedOption?.label}</span>
        <span className="ml-auto flex flex-shrink-0 items-center gap-2">
          {selectedOption?.detail && (
            <span className="text-muted-foreground">{selectedOption.detail}</span>
          )}
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </span>
      </button>

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[9999]">
          <div
            className="absolute inset-0"
            style={{ touchAction: 'none' }}
            onClick={() => close()}
          />
          <div
            ref={popoverRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="animate-in fade-in-0 zoom-in-95 absolute overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              width: position?.width ?? MIN_POPOVER_WIDTH,
              maxHeight: position?.maxHeight ?? MAX_POPOVER_HEIGHT,
              visibility: position ? 'visible' : 'hidden',
              overscrollBehavior: 'contain',
            }}
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const isActive = index === activeIndex;

              return (
                <button
                  key={option.value}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectIndex(index)}
                  className={cn(
                    'flex min-h-11 w-full touch-manipulation items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    isActive && 'bg-accent',
                  )}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}>
                    {option.label}
                  </span>
                  {option.detail && (
                    <span className="flex-shrink-0 text-muted-foreground">{option.detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
