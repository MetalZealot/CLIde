import { MessageSquare, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
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
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  // Every mode searches sessions now — the sidebar's short list of
  // repositories was never the thing worth searching for.
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : t('search.sessionsPlaceholder', 'Search session names...');

  const isContentSearch = searchMode === 'conversations';
  // Full-text search across transcripts used to be a permanent tab. It is a
  // search refinement, not a place, so it now hangs off the query itself: the
  // plain query matches session names, this reaches into their messages.
  const canSearchContents = searchFilter.trim().length >= MIN_CONTENT_SEARCH_LENGTH;

  /*
    These are render functions, not components declared in the body.
    A component declared here is a new type on every render, so React would
    unmount and remount the search input on each keystroke — which blurs it and
    dismisses the on-screen keyboard.
  */
  const renderLogoBlock = () => (
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

  /** The desktop title row keeps one structural control: collapse. */
  const renderHeaderTools = (compact: boolean) => {
    if (compact) return null;

    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
        onClick={onCollapseSidebar}
        title={t('tooltips.hideSidebar')}
      >
        <PanelLeftClose className="h-3.5 w-3.5" />
      </Button>
    );
  };

  const renderContentSearchToggle = () =>
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
            ? t('search.backToSessionNames', 'Search session names instead')
            : t('search.searchContents', 'Search inside messages')}
        </span>
      </button>
    ) : null;

  const renderSearchInput = (compact: boolean) => (
    <div className="relative">
      <Search
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50',
          compact ? 'h-4 w-4' : 'h-3.5 w-3.5',
        )}
      />
      <Input
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
              {renderLogoBlock()}
            </a>
          ) : (
            renderLogoBlock()
          )}

          {renderHeaderTools(false)}
        </div>

        <div className="mt-2.5 space-y-1">
          {renderSearchInput(false)}
          {renderContentSearchToggle()}
        </div>
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
              {renderLogoBlock()}
            </a>
          ) : (
            renderLogoBlock()
          )}

          {renderHeaderTools(true)}
        </div>

        <div className="mt-2.5 space-y-1">
          {renderSearchInput(true)}
          {renderContentSearchToggle()}
        </div>
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
