import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, RefreshCw, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MENU_LIST_MAX_HEIGHT } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import { useFavoriteModels } from '../../../../utils/favoriteModels';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];
type ProviderOption = { value: LLMProvider; label: string; connected: boolean; loading: boolean };
type MenuTab = LLMProvider | 'favorites';

interface ComposerModelMenuProps {
  effort: string;
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  modelOptions: ProviderModelOption[];
  /** Every provider's models; the current provider's come from `modelOptions`. */
  modelCatalog?: Partial<Record<LLMProvider, ProviderModelOption[]>>;
  onSelectModel: (model: string, provider: LLMProvider) => Promise<void>;
  modelsLoading: boolean;
  /** Re-reads every provider's model list from its CLI. */
  onRefreshModels?: () => Promise<void>;
  openRequest: number;
  provider: LLMProvider;
  providerLabel: string;
  providerOptions?: ProviderOption[];
  /**
   * False once the session exists: a session belongs to the runtime that
   * started it, so only a brand-new chat shows every provider's models.
   */
  canSwitchProvider?: boolean;
}

export default function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  modelCatalog = {},
  onSelectModel,
  modelsLoading,
  onRefreshModels,
  openRequest,
  provider,
  providerLabel,
  providerOptions = [],
  canSwitchProvider = false,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  // Tabs browse without switching; picking a model is what commits a provider.
  // Legacy models drill in because every extra row on a phone-height composer
  // pushes the effort slider off screen.
  const [tab, setTab] = useState<MenuTab>(provider);
  const [view, setView] = useState<'models' | 'legacy'>('models');
  const { favorites, isFavorite, toggleFavorite } = useFavoriteModels();
  const [selectingModel, setSelectingModel] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const effortTrackRef = useRef<HTMLDivElement | null>(null);
  const effortDragRef = useRef({ active: false, moved: false, startX: 0 });
  // A drag paints the track locally and commits once, on release. Committing
  // per step would fire a write per stop crossed, and those writes race.
  const [effortPreview, setEffortPreview] = useState<string | null>(null);
  const close = useCallback(() => {
    setIsOpen(false);
    setView('models');
  }, []);
  const resetPanes = useCallback(() => {
    setSelectionError(null);
    setView('models');
    setTab(provider);
  }, [provider]);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 14 * 16);

  useEffect(() => {
    if (openRequest > 0) {
      resetPanes();
      updateAnchor();
      setIsOpen(true);
    }
    // Only a new request opens the menu, not a provider change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest, updateAnchor]);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const displayedEffort = effortPreview ?? effort;
  const effortLabel = displayedEffort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : displayedEffort;
  const modelLabel = modelOptions.find((option) => option.value === model)?.label || model;
  const optionsFor = useCallback(
    (target: LLMProvider) => (target === provider ? modelOptions : modelCatalog[target] ?? []),
    [modelCatalog, modelOptions, provider],
  );
  const providerLabelFor = useCallback(
    (target: LLMProvider) => (target === provider
      ? providerLabel
      : providerOptions.find((option) => option.value === target)?.label ?? target),
    [provider, providerLabel, providerOptions],
  );
  // The current provider always shows; others only once connected or still checking.
  const stripProviders = useMemo<LLMProvider[]>(() => {
    if (!canSwitchProvider) return [provider];
    const shown = providerOptions
      .filter((option) => option.value === provider || option.connected || option.loading)
      .map((option) => option.value);
    return shown.includes(provider) ? shown : [provider, ...shown];
  }, [canSwitchProvider, provider, providerOptions]);
  const browsedProvider = tab === 'favorites' ? null : tab;
  const browsedOptions = useMemo(
    () => (browsedProvider ? optionsFor(browsedProvider) : []),
    [browsedProvider, optionsFor],
  );
  const primaryModels = useMemo(
    () => browsedOptions.filter((option) => option.group !== 'legacy'),
    [browsedOptions],
  );
  const legacyModels = useMemo(
    () => browsedOptions.filter((option) => option.group === 'legacy'),
    [browsedOptions],
  );
  const selectedLegacyModel = browsedProvider === provider
    ? legacyModels.find((option) => option.value === model) ?? null
    : null;
  // A favourite whose model left the catalog stays stored but is not offered.
  const favoriteRows = useMemo(
    () => favorites.flatMap((entry) => {
      if (!stripProviders.includes(entry.provider)) return [];
      const option = optionsFor(entry.provider).find((candidate) => candidate.value === entry.model);
      return option ? [{ provider: entry.provider, option }] : [];
    }),
    [favorites, optionsFor, stripProviders],
  );
  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading || canSwitchProvider;
  const ariaLabel = t('composer.modelMenu', { defaultValue: 'Select model and reasoning effort' });
  const legacyLabel = t('composer.legacyModels', { defaultValue: 'Legacy' });
  const defaultBadgeLabel = t('composer.modelIsDefault', { defaultValue: 'Default' });
  const favoritesLabel = t('composer.favoriteModels', { defaultValue: 'Favourites' });
  const handleSelectModel = useCallback(async (nextModel: string, targetProvider: LLMProvider) => {
    setSelectionError(null);
    setSelectingModel(`${targetProvider}:${nextModel}`);
    try {
      await onSelectModel(nextModel, targetProvider);
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
    const nextEffort = effortValueAt(event.clientX) ?? effortPreview;
    setEffortPreview(null);
    if (nextEffort && nextEffort !== effort) onSelectEffort(nextEffort);
  }, [effort, effortPreview, effortValueAt, onSelectEffort]);

  const handleEffortPointerCancel = useCallback(() => {
    effortDragRef.current.active = false;
    effortDragRef.current.moved = false;
    setEffortPreview(null);
  }, []);

  if (!hasEffortSection && !hasModelSection) return null;

  const renderModelItem = (option: ProviderModelOption, target: LLMProvider, showProvider = false) => {
    const starred = isFavorite(target, option.value);
    const starLabel = starred
      ? t('composer.unfavoriteModel', { defaultValue: 'Remove from favourites' })
      : t('composer.favoriteModel', { defaultValue: 'Add to favourites' });
    return (
      <div key={`${target}:${option.value}`} className="flex items-center gap-0.5">
        <ComposerMenuItem
          className="min-w-0 flex-1"
          label={option.isDefault ? (
            <span className="flex items-baseline gap-1.5">
              <span className="truncate">{option.label || option.value}</span>
              <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium leading-4 text-muted-foreground">
                {defaultBadgeLabel}
              </span>
            </span>
          ) : (option.label || option.value)}
          description={showProvider ? (
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="shrink-0">
                <SessionProviderLogo provider={target} className="h-3 w-3" />
              </span>
              <span className="truncate">{providerLabelFor(target)}</span>
            </span>
          ) : undefined}
          isSelected={target === provider && option.value === model}
          onSelect={() => { void handleSelectModel(option.value, target); }}
          disabled={selectingModel !== null}
          trailing={selectingModel === `${target}:${option.value}`
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : undefined}
        />
        <button
          type="button"
          onClick={() => toggleFavorite(target, option.value)}
          aria-pressed={starred}
          aria-label={starLabel}
          title={starLabel}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
        >
          <Star className={`h-3.5 w-3.5 ${starred ? 'fill-current text-foreground' : ''}`} aria-hidden />
        </button>
      </div>
    );
  };

  const renderTab = (value: MenuTab) => {
    const isActive = tab === value;
    const label = value === 'favorites' ? favoritesLabel : providerLabelFor(value);
    const showName = value !== 'favorites' && !canSwitchProvider;
    return (
      <button
        key={value}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={label}
        title={label}
        onClick={() => {
          setSelectionError(null);
          setView('models');
          setTab(value);
        }}
        className={`flex h-8 items-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          showName ? 'min-w-0 flex-1 px-1.5' : 'w-8 shrink-0 justify-center'
        } ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
      >
        {value === 'favorites' ? (
          <Star className={`h-4 w-4 ${isActive ? 'fill-current' : ''}`} aria-hidden />
        ) : (
          <span aria-hidden="true" className="shrink-0">
            <SessionProviderLogo provider={value} className="h-4 w-4" />
          </span>
        )}
        {showName && <span className="truncate">{label}</span>}
      </button>
    );
  };

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
          if (!isOpen) resetPanes();
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
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface
          anchor={anchor}
          menuRef={menuRef}
          ariaLabel={ariaLabel}
        >
          <div className="w-56 max-w-full">
            {view === 'legacy' ? (
              <div className="py-0.5">
                {renderBackRow(
                  legacyLabel,
                  t('composer.backToModels', { defaultValue: 'Back to models' }),
                )}
                <ComposerMenuSeparator />
                <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MENU_LIST_MAX_HEIGHT }}>
                  {browsedProvider && legacyModels.map((option) => renderModelItem(option, browsedProvider))}
                </div>
                {selectionError && (
                  <p role="alert" className="px-2.5 py-1.5 text-xs leading-4 text-destructive">
                    {selectionError}
                  </p>
                )}
              </div>
            ) : (
              <>
              <div
                role="tablist"
                aria-label={t('composer.provider', { defaultValue: 'Provider' })}
                className="flex items-center gap-1 px-1 pb-1 pt-0.5"
              >
                {renderTab('favorites')}
                {stripProviders.map(renderTab)}
              </div>
              <ComposerMenuSeparator />

              {hasModelSection && (
                <div className="py-0.5">
                  {/* The list scrolls, not the menu: the tabs above and the
                      effort slider below stay reachable however many models
                      a provider offers. */}
                  <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MENU_LIST_MAX_HEIGHT }}>
                    {tab === 'favorites' ? (
                      favoriteRows.length > 0
                        ? favoriteRows.map((row) => renderModelItem(row.option, row.provider, true))
                        : (
                          <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                            {t('composer.noFavoriteModels', { defaultValue: 'Star a model to pin it here.' })}
                          </p>
                        )
                    ) : (
                      <>
                        {browsedOptions.length === 0 && (
                          <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                            {modelsLoading
                              ? t('composer.loadingModels', { defaultValue: 'Loading models…' })
                              : t('composer.noModels', { defaultValue: 'No models available.' })}
                          </p>
                        )}
                        {browsedProvider && primaryModels.map((option) => renderModelItem(option, browsedProvider))}
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
                      </>
                    )}
                  </div>
                  {onRefreshModels && (
                    <button
                      type="button"
                      onClick={() => { void onRefreshModels(); }}
                      disabled={modelsLoading}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none"
                    >
                      <RefreshCw className={`h-3 w-3 shrink-0 ${modelsLoading ? 'animate-spin' : ''}`} aria-hidden />
                      <span className="truncate">
                        {modelsLoading
                          ? t('composer.refreshingModels', { defaultValue: 'Checking for new models…' })
                          : t('composer.refreshModels', { defaultValue: 'Refresh models' })}
                      </span>
                    </button>
                  )}
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
                            onClick={(event) => {
                              // The track owns pointer choices; detail-less activation is keyboard or assistive tech.
                              if (event.detail === 0) onSelectEffort(option.value);
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
