import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ProviderModelOption } from '../../../../types/app';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

interface ComposerModelMenuProps {
  effort: string;
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  openRequest: number;
}

export default function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
  openRequest,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const effortTrackRef = useRef<HTMLDivElement | null>(null);
  const effortDragRef = useRef({ active: false, moved: false, startX: 0, lastValue: effort });
  const suppressEffortClickRef = useRef(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 14 * 16);

  useEffect(() => {
    if (openRequest > 0) {
      updateAnchor();
      setIsOpen(true);
    }
  }, [openRequest, updateAnchor]);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : effort;
  const modelLabel = modelOptions.find((option) => option.value === model)?.label || model;
  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  const ariaLabel = t('composer.modelMenu', { defaultValue: 'Select model and reasoning effort' });
  const selectEffortAt = useCallback((clientX: number) => {
    const rect = effortTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || resolvedEffortOptions.length === 0) return;

    const offset = Math.min(Math.max(clientX - rect.left, 0), Math.max(0, rect.width - 0.01));
    const index = Math.floor((offset / rect.width) * resolvedEffortOptions.length);
    const nextEffort = resolvedEffortOptions[index]?.value;
    if (!nextEffort || nextEffort === effortDragRef.current.lastValue) return;

    effortDragRef.current.lastValue = nextEffort;
    onSelectEffort(nextEffort);
  }, [onSelectEffort, resolvedEffortOptions]);

  const handleEffortPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    effortDragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      lastValue: effort,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [effort]);

  const handleEffortPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = effortDragRef.current;
    if (!drag.active) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;

    drag.moved = true;
    selectEffortAt(event.clientX);
  }, [selectEffortAt]);

  const handleEffortPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = effortDragRef.current;
    if (!drag.active) return;

    if (drag.moved) {
      selectEffortAt(event.clientX);
      suppressEffortClickRef.current = true;
      queueMicrotask(() => {
        suppressEffortClickRef.current = false;
      });
    }
    drag.active = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [selectEffortAt]);

  const handleEffortPointerCancel = useCallback(() => {
    effortDragRef.current.active = false;
    effortDragRef.current.moved = false;
  }, []);

  if (!hasEffortSection && !hasModelSection) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-36 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-64"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{hasModelSection ? modelLabel : effortLabel}</span>
        {hasModelSection && hasEffortSection && (
          <span className="shrink-0 capitalize text-muted-foreground">{effortLabel}</span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          <div className="w-52 max-w-full">
            {hasModelSection && (
              <div className="py-0.5">
                {modelOptions.length === 0 && modelsLoading && (
                  <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                    {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                  </p>
                )}
                {modelOptions.map((option) => (
                  <ComposerMenuItem
                    key={option.value}
                    label={option.label || option.value}
                    isSelected={option.value === model}
                    onSelect={() => {
                      onSelectModel(option.value);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            )}

            {hasEffortSection && (
              <>
                {hasModelSection && <ComposerMenuSeparator />}
                <div className="px-2 pb-1.5 pt-1" role="group" aria-label={t('composer.reasoning', { defaultValue: 'Reasoning' })}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 px-0.5 text-xs">
                    <span className="text-muted-foreground">
                      {t('composer.effort', { defaultValue: 'Effort' })}
                    </span>
                    <span className="font-medium capitalize text-foreground">{effortLabel}</span>
                  </div>
                  <div
                    ref={effortTrackRef}
                    role="radiogroup"
                    aria-label={t('composer.reasoning', { defaultValue: 'Reasoning' })}
                    className="grid h-8 cursor-ew-resize touch-none select-none rounded-lg bg-muted/70 p-0.5"
                    style={{ gridTemplateColumns: `repeat(${resolvedEffortOptions.length}, minmax(0, 1fr))` }}
                    onPointerDown={handleEffortPointerDown}
                    onPointerMove={handleEffortPointerMove}
                    onPointerUp={handleEffortPointerUp}
                    onPointerCancel={handleEffortPointerCancel}
                  >
                    {resolvedEffortOptions.map((option) => {
                      const label = option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value;
                      const isSelected = option.value === effort;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={label}
                          title={option.description || label}
                          onClick={() => {
                            if (suppressEffortClickRef.current) return;
                            effortDragRef.current.lastValue = option.value;
                            onSelectEffort(option.value);
                          }}
                          className="group flex min-w-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className={isSelected
                            ? 'h-6 w-6 rounded-md border border-border bg-background shadow-sm'
                            : 'h-1 w-1 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-muted-foreground'}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
