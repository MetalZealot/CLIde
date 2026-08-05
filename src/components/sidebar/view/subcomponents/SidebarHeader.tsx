import { useEffect, useRef } from 'react';
import { Activity, Archive, FolderPlus, MessageSquare, Plus, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input, Tooltip } from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** Full-text search reads every transcript, so it waits for a real query. */
const MIN_CONTENT_SEARCH_LENGTH = 2;

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  isSearchBarOpen: boolean;
  onToggleSearchBar: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  isSearchBarOpen,
  onToggleSearchBar,
  searchMode,
  onSearchModeChange,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchBarOpen) {
      desktopSearchInputRef.current?.focus();
      mobileSearchInputRef.current?.focus();
    }
  }, [isSearchBarOpen]);

  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : searchMode === 'running'
        ? t('search.runningPlaceholder', 'Search running sessions...')
        : t('projects.searchPlaceholder');
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);

  /**
   * Running and Archive are alternate views of the same list, so their icons
   * toggle rather than latch — pressing the active one returns to Projects.
   * That is what lets the old four-way tab strip disappear entirely.
   */
  const toggleSearchMode = (mode: SidebarSearchMode) => {
    onSearchModeChange(searchMode === mode ? 'projects' : mode);
  };

  const isContentSearch = searchMode === 'conversations';
  // Full-text search across transcripts used to be a permanent tab. It is a
  // search refinement, not a place, so it now hangs off the query itself.
  const canSearchContents =
    isSearchBarOpen && searchFilter.trim().length >= MIN_CONTENT_SEARCH_LENGTH;

  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        aria-hidden
        className="h-7 w-7 flex-shrink-0 bg-foreground"
        style={{
          WebkitMaskImage: 'url(/logo.svg)',
          maskImage: 'url(/logo.svg)',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
      <h1
        className="truncate text-sm font-bold tracking-tight text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );

  /**
   * Search, Running and Archive sit on the title row beside New Project, so the
   * list starts one row higher than it did with the segmented control.
   */
  const HeaderTools = ({ compact }: { compact: boolean }) => {
    const buttonSize = compact ? 'h-8 w-8' : 'h-7 w-7';
    const iconSize = compact ? 'h-4 w-4' : 'h-3.5 w-3.5';
    const toolClass = (isActive: boolean) =>
      cn(
        'relative flex flex-shrink-0 items-center justify-center rounded-lg transition-all',
        buttonSize,
        compact && 'active:scale-95',
        isActive
          ? 'bg-muted/60 text-foreground'
          : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground',
      );

    return (
      <div className={cn('flex flex-shrink-0 items-center', compact ? 'gap-1' : 'gap-0.5')}>
        {showSearchTools && (
          <>
            <button
              type="button"
              onClick={onToggleSearchBar}
              aria-pressed={isSearchBarOpen}
              aria-label={t('tooltips.toggleSearch', 'Search')}
              title={t('tooltips.toggleSearch', 'Search')}
              className={toolClass(isSearchBarOpen)}
            >
              <Search className={iconSize} />
            </button>

            <Tooltip content={t('search.runningTooltip', 'Running sessions')} position="bottom">
              <button
                type="button"
                onClick={() => toggleSearchMode('running')}
                aria-pressed={searchMode === 'running'}
                aria-label={t('search.runningTooltip', 'Running sessions')}
                className={toolClass(searchMode === 'running')}
              >
                <Activity
                  className={cn(iconSize, runningSessionsCount > 0 && 'text-emerald-500')}
                />
                {runningSessionsCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-semibold leading-none text-white shadow-sm ring-1 ring-background">
                    {runningBadgeText}
                  </span>
                )}
              </button>
            </Tooltip>

            <Tooltip content={t('search.archiveOnlyTooltip', 'Archive only')} position="bottom">
              <button
                type="button"
                onClick={() => toggleSearchMode('archived')}
                aria-pressed={searchMode === 'archived'}
                aria-label={t('search.archiveOnlyTooltip', 'Archive only')}
                className={toolClass(searchMode === 'archived')}
              >
                <Archive className={iconSize} />
              </button>
            </Tooltip>
          </>
        )}

        {compact ? (
          <button
            type="button"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
            onClick={onCreateProject}
            aria-label={t('tooltips.createProject')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    );
  };

  const ContentSearchToggle = () =>
    canSearchContents ? (
      <button
        type="button"
        onClick={() => onSearchModeChange(isContentSearch ? 'projects' : 'conversations')}
        aria-pressed={isContentSearch}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] transition-colors',
          isContentSearch
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <MessageSquare className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">
          {isContentSearch
            ? t('search.backToProjects', 'Search project names instead')
            : t('search.searchContents', 'Search inside messages')}
        </span>
      </button>
    ) : null;

  const SearchInput = ({ compact }: { compact: boolean }) => (
    <div className="relative">
      <Search
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50',
          compact ? 'h-4 w-4' : 'h-3.5 w-3.5',
        )}
      />
      <Input
        ref={compact ? mobileSearchInputRef : desktopSearchInputRef}
        type="text"
        placeholder={searchPlaceholder}
        value={searchFilter}
        onChange={(event) => onSearchFilterChange(event.target.value)}
        className={cn(
          'nav-search-input rounded-xl border-0 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0',
          compact ? 'h-10 pl-10 pr-9' : 'h-9 pl-9 pr-14',
        )}
      />
      {searchFilter ? (
        <button
          onClick={onClearSearchFilter}
          aria-label={t('tooltips.clearSearch')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
        >
          <X className={cn('text-muted-foreground', compact ? 'h-3.5 w-3.5' : 'h-3 w-3')} />
        </button>
      ) : (
        !compact && (
          <kbd
            aria-hidden
            title={t('tooltips.openCommandPalette')}
            className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
          >
            {MOD_KEY}
            <span>K</span>
          </kbd>
        )
      )}
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div className="hidden px-3 pb-2 pt-3 md:block">
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <HeaderTools compact={false} />
        </div>

        {isSearchBarOpen && showSearchTools && (
          <div className="mt-2.5 space-y-1">
            <SearchInput compact={false} />
            <ContentSearchToggle />
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        // The mobile drawer runs edge-to-edge to the top of the viewport (see
        // MobileSidebarOverlay), so in the standalone PWA the header content must
        // clear the status bar itself — pad by the safe-area inset plus a small
        // base gap. The panel surface fills behind it, so no bare strip shows.
        style={isPWA && isMobile ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' } : {}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <HeaderTools compact />
        </div>

        {isSearchBarOpen && showSearchTools && (
          <div className="mt-2.5 space-y-1">
            <SearchInput compact />
            <ContentSearchToggle />
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
