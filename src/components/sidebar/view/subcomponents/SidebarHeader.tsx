import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowUpDown,
  Check,
  ChevronDown,
  Folder,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  Search,
  X,
} from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  Button,
  ContextMenuOverlay,
  Input,
  anchorFromElement,
} from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';
import type {
  BrowseSessionViewOptions,
  ProjectViewOptions,
  SidebarBrowseMode,
  SidebarSearchMode,
} from '../../types/types';
import { isDefaultBrowseSessionView, isDefaultProjectView } from '../../utils/utils';

import SidebarBrowseFilterMenu from './SidebarBrowseFilterMenu';

/** Full-text search reads every transcript, so it waits for a real query. */
const MIN_CONTENT_SEARCH_LENGTH = 2;

type SidebarHeaderProps = {
  browseMode: SidebarBrowseMode;
  onBrowseModeChange: (mode: SidebarBrowseMode) => void;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  projectView: ProjectViewOptions;
  browseSessionView: BrowseSessionViewOptions;
  onProjectViewChange: (options: ProjectViewOptions) => void;
  onBrowseSessionViewChange: (options: BrowseSessionViewOptions) => void;
  onProjectViewReset: () => void;
  onBrowseSessionViewReset: () => void;
  onCollapseSidebar: () => void;
  onOpenNewSession: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  browseMode,
  onBrowseModeChange,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  projectView,
  browseSessionView,
  onProjectViewChange,
  onBrowseSessionViewChange,
  onProjectViewReset,
  onBrowseSessionViewReset,
  onCollapseSidebar,
  onOpenNewSession,
  t,
}: SidebarHeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(searchFilter));
  const [isBrowseMenuOpen, setIsBrowseMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isArchiveOpen = searchMode === 'archived';
  const isContentSearch = searchMode === 'conversations';
  const canSearchContents = !isArchiveOpen && searchFilter.trim().length >= MIN_CONTENT_SEARCH_LENGTH;
  const browseLabel = isArchiveOpen
    ? t('actions.archive', 'Archive')
    : browseMode === 'projects'
      ? t('search.modeProjects')
      : t('search.modeConversations');
  const BrowseIcon = isArchiveOpen ? Archive : browseMode === 'projects' ? Folder : MessageSquare;
  const isFilterCustomized = browseMode === 'projects'
    ? !isDefaultProjectView(projectView)
    : !isDefaultBrowseSessionView(browseSessionView);
  const searchPlaceholder = isArchiveOpen
    ? t('search.archivedPlaceholder', 'Search archived sessions...')
    : isContentSearch
      ? t('search.conversationsPlaceholder')
      : t('search.sessionsPlaceholder', 'Search session names...');

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  const closeSearch = () => {
    onClearSearchFilter();
    if (isContentSearch) {
      onSearchModeChange('projects');
    }
    setIsSearchOpen(false);
  };

  const chooseBrowseMode = (mode: SidebarBrowseMode) => {
    setIsBrowseMenuOpen(false);
    onSearchModeChange('projects');
    onBrowseModeChange(mode);
  };

  const chooseArchive = () => {
    setIsBrowseMenuOpen(false);
    setIsFilterMenuOpen(false);
    onSearchModeChange('archived');
  };

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

  /** New Session stays in the desktop header and the mobile thumb-zone footer. */
  const renderHeaderTools = (compact: boolean) => (
    <div className="flex items-center gap-0.5">
      {!compact && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
          onClick={onOpenNewSession}
          aria-label={t('sessions.newSession')}
          title={t('sessions.newSession')}
        >
          <MessageSquarePlus strokeWidth={1.5} className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground',
          compact ? 'h-8 w-8 active:scale-95' : 'h-7 w-7',
        )}
        onClick={onCollapseSidebar}
        aria-label={t('tooltips.hideSidebar')}
        title={t('tooltips.hideSidebar')}
      >
        <PanelLeftClose strokeWidth={1.5} className={compact ? '!h-5 !w-5' : 'h-3.5 w-3.5'} />
      </Button>
    </div>
  );

  const renderAppBar = (compact: boolean) => (
    <div className="app-bar justify-between gap-2 px-3">
      {IS_PLATFORM ? (
        <a
          href="https://cloudcli.ai/dashboard"
          className={cn(
            'flex min-w-0 items-center gap-2.5 transition-opacity',
            compact ? 'active:opacity-70' : 'hover:opacity-80',
          )}
          title={t('tooltips.viewEnvironments')}
        >
          {renderLogoBlock()}
        </a>
      ) : (
        renderLogoBlock()
      )}
      {renderHeaderTools(compact)}
    </div>
  );

  return (
    <div className="flex-shrink-0">
      <div className="hidden md:block">{renderAppBar(false)}</div>
      <div className="md:hidden">{renderAppBar(true)}</div>

      <div className="flex items-center gap-1 px-3 pb-2 pt-1">
        <button
          ref={browseButtonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isBrowseMenuOpen}
          aria-label={browseLabel}
          title={browseLabel}
          onClick={() => {
            setIsFilterMenuOpen(false);
            setIsBrowseMenuOpen((current) => !current);
          }}
          className={cn(
            'sidebar-utility-hit-target flex h-8 min-w-0 max-w-28 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:bg-accent/60',
            isSearchOpen && 'md:w-8 md:justify-center md:px-0',
          )}
        >
          <BrowseIcon className="h-3 w-3 flex-shrink-0" />
          <span className={cn('truncate', isSearchOpen && 'md:hidden')}>{browseLabel}</span>
          <ChevronDown className={cn(
            'h-3 w-3 flex-shrink-0 transition-transform',
            isBrowseMenuOpen && 'rotate-180',
            isSearchOpen && 'md:hidden',
          )} />
        </button>

        {isSearchOpen ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder={searchPlaceholder}
              value={searchFilter}
              onChange={(event) => onSearchFilterChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSearch();
                }
              }}
              className={cn(
                'nav-search-input h-8 rounded-lg border-0 pl-8 text-xs placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0',
                canSearchContents ? 'pr-14' : 'pr-9',
              )}
            />
            {canSearchContents && (
              <button
                type="button"
                onClick={() => onSearchModeChange(isContentSearch ? 'projects' : 'conversations')}
                aria-pressed={isContentSearch}
                aria-label={isContentSearch
                  ? t('search.backToSessionNames', 'Search session names instead')
                  : t('search.searchContents', 'Search inside messages')}
                title={isContentSearch
                  ? t('search.backToSessionNames', 'Search session names instead')
                  : t('search.searchContents', 'Search inside messages')}
                className={cn(
                  'absolute right-7 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition-colors',
                  isContentSearch
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <MessageSquare className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={closeSearch}
              aria-label={t('tooltips.clearSearch')}
              title={t('tooltips.clearSearch')}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span aria-hidden className="flex-1" />
        )}

        {!isSearchOpen && (
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-label={t('tooltips.toggleSearch')}
            title={t('tooltips.toggleSearch')}
            className="sidebar-utility-hit-target flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:bg-accent/60"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}

        {!isArchiveOpen && (
          <button
            ref={filterButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isFilterMenuOpen}
            aria-pressed={isFilterCustomized}
            aria-label={t('browseView.filter', 'Sort')}
            title={t('browseView.filter', 'Sort')}
            onClick={() => {
              setIsBrowseMenuOpen(false);
              setIsFilterMenuOpen((current) => !current);
            }}
            className={cn(
              'sidebar-utility-hit-target flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
              isFilterCustomized
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent/60',
            )}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isBrowseMenuOpen && browseButtonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(browseButtonRef.current, { x: 0, y: 0 })}
          onDismiss={() => setIsBrowseMenuOpen(false)}
          ariaLabel={`${t('search.modeProjects')} / ${t('search.modeConversations')} / ${t('actions.archive', 'Archive')}`}
          className="sidebar-context-menu min-w-40 rounded-xl py-1"
        >
          {(['projects', 'sessions'] as const).map((mode) => {
            const isSelected = browseMode === mode;
            const Icon = mode === 'projects' ? Folder : MessageSquare;
            const label = mode === 'projects'
              ? t('search.modeProjects')
              : t('search.modeConversations');

            return (
              <button
                key={mode}
                type="button"
                role="menuitem"
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => chooseBrowseMode(mode)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className={cn('truncate', isSelected && 'font-medium')}>{label}</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            aria-current={isArchiveOpen ? 'true' : undefined}
            onClick={chooseArchive}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
              {isArchiveOpen && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            <Archive className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span className={cn('truncate', isArchiveOpen && 'font-medium')}>
              {t('actions.archive', 'Archive')}
            </span>
          </button>
        </ContextMenuOverlay>
      )}

      {isFilterMenuOpen && filterButtonRef.current && !isArchiveOpen && (
        <SidebarBrowseFilterMenu
          anchor={anchorFromElement(filterButtonRef.current, { x: 0, y: 0 })}
          browseMode={browseMode}
          projectOptions={projectView}
          sessionOptions={browseSessionView}
          onProjectChange={onProjectViewChange}
          onSessionChange={onBrowseSessionViewChange}
          onProjectReset={onProjectViewReset}
          onSessionReset={onBrowseSessionViewReset}
          onClose={() => setIsFilterMenuOpen(false)}
          t={t}
        />
      )}

      <div className="nav-divider" />
    </div>
  );
}
