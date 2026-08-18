import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MENU_LIST_MAX_HEIGHT } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];
type ProviderOption = { value: LLMProvider; label: string };

interface ComposerModelMenuProps {
  effort: string;
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => Promise<void>;
  modelsLoading: boolean;
  openRequest: number;
  provider: LLMProvider;
  providerLabel: string;
  providerOptions?: ProviderOption[];
  /**
   * Omitted once the session exists: a session belongs to the runtime that
   * started it, so the provider row becomes a static label there and only a
   * brand-new chat can still switch.
   */
  onSelectProvider?: ((provider: LLMProvider) => void) | null;
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
  provider,
  providerLabel,
  providerOptions = [],
  onSelectProvider = null,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  // One popover, three panes. Providers and legacy models both drill in rather
  // than extending the list, because this menu is opened from a phone-height
  // composer and every extra row pushes the effort slider off screen.
  const [view, setView] = useState<'models' | 'providers' | 'legacy'>('models');
  const [selectingModel, setSelectingModel] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const effortTrackRef = useRef<HTMLDivElement | null>(null);
  const effortDragRef = useRef({ active: false, moved: false, startX: 0 });
  const suppressEffortClickRef = useRef(false);
  // A drag paints the track locally and commits once, on release. Committing
  // per step would fire a write per stop crossed, and those writes race.
  const [effortPreview, setEffortPreview] = useState<string | null>(null);
  const close = useCallback(() => {
    setIsOpen(false);
    setView('models');
  }, []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 14 * 16);

  useEffect(() => {
    if (openRequest > 0) {
      setSelectionError(null);
      setView('models');
      updateAnchor();
      setIsOpen(true);
    }
  }, [openRequest, updateAnchor]);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const displayedEffort = effortPreview ?? effort;
  const effortLabel = displayedEffort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : displayedEffort;
  const modelLabel = modelOptions.find((option) => option.value === model)?.label || model;
  const primaryModels = useMemo(
    () => modelOptions.filter((option) => option.group !== 'legacy'),
    [modelOptions],
  );
  const legacyModels = useMemo(
    () => modelOptions.filter((option) => option.group === 'legacy'),
    [modelOptions],
  );
  const selectedLegacyModel = legacyModels.find((option) => option.value === model) ?? null;
  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  const canSwitchProvider = Boolean(onSelectProvider) && providerOptions.length > 1;
  const ariaLabel = t('composer.modelMenu', { defaultValue: 'Select model and reasoning effort' });
  const providerAriaLabel = t('composer.providerMenu', { defaultValue: 'Select model provider' });
  const legacyLabel = t('composer.legacyModels', { defaultValue: 'Legacy' });
  const defaultBadgeLabel = t('composer.modelIsDefault', { defaultValue: 'Default' });
  const handleSelectProvider = useCallback((nextProvider: LLMProvider) => {
    setSelectionError(null);
    setView('models');
    onSelectProvider?.(nextProvider);
  }, [onSelectProvider]);
  const handleSelectModel = useCallback(async (nextModel: string) => {
    setSelectionError(null);
    setSelectingModel(nextModel);
    try {
      await onSelectModel(nextModel);
      setIsOpen(false);
    } catch (error) {
      setSelectionError(error instanceof Error
        ? error.message
        : t('composer.modelChangeFailed', { defaultValue: 'Unable to change the active model.' }));
    } finally {
      setSelectingModel(null);
    }
  }, [onSelectModel, t]);
  const effortValueAt = useCallback((clientX: number): string | null => {
    const rect = effortTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || resolvedEffortOptions.length === 0) return null;

    const offset = Math.min(Math.max(clientX - rect.left, 0), Math.max(0, rect.width - 0.01));
    const index = Math.floor((offset / rect.width) * resolvedEffortOptions.length);
    return resolvedEffortOptions[index]?.value ?? null;
  }, [resolvedEffortOptions]);

  const handleEffortPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    effortDragRef.current = { active: true, moved: false, startX: event.clientX };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleEffortPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = effortDragRef.current;
    if (!drag.active) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;

    drag.moved = true;
    const nextEffort = effortValueAt(event.clientX);
    if (nextEffort) setEffortPreview(nextEffort);
  }, [effortValueAt]);

  const handleEffortPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = effortDragRef.current;
    if (!drag.active) return;

    drag.active = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;

    const nextEffort = effortValueAt(event.clientX) ?? effortPreview;
    setEffortPreview(null);
    // The tap that ends a drag would otherwise re-fire on the button underneath.
    suppressEffortClickRef.current = true;
    queueMicrotask(() => {
      suppressEffortClickRef.current = false;
    });
    if (nextEffort && nextEffort !== effort) onSelectEffort(nextEffort);
  }, [effort, effortPreview, effortValueAt, onSelectEffort]);

  const handleEffortPointerCancel = useCallback(() => {
    effortDragRef.current.active = false;
    effortDragRef.current.moved = false;
    setEffortPreview(null);
  }, []);

  if (!hasEffortSection && !hasModelSection && !canSwitchProvider) return null;

  const renderModelItem = (option: ProviderModelOption) => (
    <ComposerMenuItem
      key={option.value}
      label={option.isDefault ? (
        <span className="flex items-baseline gap-1.5">
          <span className="truncate">{option.label || option.value}</span>
          <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium leading-4 text-muted-foreground">
            {defaultBadgeLabel}
          </span>
        </span>
      ) : (option.label || option.value)}
      isSelected={option.value === model}
      onSelect={() => { void handleSelectModel(option.value); }}
      disabled={selectingModel !== null}
      trailing={selectingModel === option.value
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : undefined}
    />
  );

  const renderBackRow = (label: string, ariaText: string) => (
    <button
      type="button"
      onClick={() => setView('models')}
      className="flex w-full items-center gap-1 rounded-lg px-1.5 py-1 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      aria-label={ariaText}
    >
      <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );

  const triggerLabel = hasModelSection
    ? modelLabel
    : hasEffortSection
      ? effortLabel
      : providerLabel;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!isOpen) {
            setSelectionError(null);
            setView('models');
          }
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-36 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-64"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        {hasModelSection && hasEffortSection && (
          <span className="shrink-0 capitalize text-muted-foreground">{effortLabel}</span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface
          anchor={anchor}
          menuRef={menuRef}
          ariaLabel={view === 'providers' ? providerAriaLabel : ariaLabel}
        >
          <div className="w-52 max-w-full">
            {view === 'providers' ? (
              <div className="py-0.5">
                {renderBackRow(
                  t('composer.provider', { defaultValue: 'Provider' }),
                  t('composer.backToModels', { defaultValue: 'Back to models' }),
                )}
                <ComposerMenuSeparator />
                <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MENU_LIST_MAX_HEIGHT }}>
                  {providerOptions.map((option) => (
                    <ComposerMenuItem
                      key={option.value}
                      label={option.label}
                      isSelected={option.value === provider}
                      onSelect={() => handleSelectProvider(option.value)}
                    />
                  ))}
                </div>
              </div>
            ) : view === 'legacy' ? (
              <div className="py-0.5">
                {renderBackRow(
                  legacyLabel,
                  t('composer.backToModels', { defaultValue: 'Back to models' }),
                )}
                <ComposerMenuSeparator />
                <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MENU_LIST_MAX_HEIGHT }}>
                  {legacyModels.map(renderModelItem)}
                </div>
                {selectionError && (
                  <p role="alert" className="px-2.5 py-1.5 text-xs leading-4 text-destructive">
                    {selectionError}
                  </p>
                )}
              </div>
            ) : (
              <>
              <div className="px-1 pb-1 pt-0.5">
                {canSwitchProvider ? (
                  <button
                    type="button"
                    onClick={() => setView('providers')}
                    aria-haspopup="menu"
                    aria-label={providerAriaLabel}
                    title={providerAriaLabel}
                    className="flex w-full items-center gap-1 rounded-lg px-1.5 py-1 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="truncate">{providerLabel}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ) : (
                  <span className="block truncate px-1.5 py-1 text-sm font-medium text-muted-foreground">
                    {providerLabel}
                  </span>
                )}
              </div>
              <ComposerMenuSeparator />

              {hasModelSection && (
                <div className="py-0.5">
                  {modelOptions.length === 0 && modelsLoading && (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                      {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                    </p>
                  )}
                  {/* The list scrolls, not the menu: the provider row above and
                      the effort slider below stay reachable however many models
                      a provider offers. */}
                  <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MENU_LIST_MAX_HEIGHT }}>
                    {primaryModels.map(renderModelItem)}
                    {legacyModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setView('legacy')}
                        aria-haspopup="menu"
                        className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {legacyLabel}
                          {selectedLegacyModel && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {selectedLegacyModel.label || selectedLegacyModel.value}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    )}
                  </div>
                  {selectionError && (
                    <p role="alert" className="px-2.5 py-1.5 text-xs leading-4 text-destructive">
                      {selectionError}
                    </p>
                  )}
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
                        const isSelected = option.value === displayedEffort;
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
              </>
            )}
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
