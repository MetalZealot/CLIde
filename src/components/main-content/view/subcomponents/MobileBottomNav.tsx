import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Check, ChevronUp, Clock, Ellipsis, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuOverlay, MENU_LIST_MAX_HEIGHT, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { AppTab } from '../../../../types/app';
import { useLongPress } from '../../../../hooks/useLongPress';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';
import type { ActivityState } from '../../../sidebar/types/types';
import {
  BASE_TABS,
  BROWSER_TAB,
  TASKS_TAB,
  getPluginTabs,
  type TabDefinition,
} from '../../constants/workspaceTabs';
import { MENU_CLASS_NAME, MENU_ITEM_CLASS_NAME } from '../../constants/menu';
import { useMenuButton } from '../../hooks/useMenuButton';

type MobileBottomNavProps = {
  activeTab: AppTab;
  hasSelectedProject: boolean;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  /** The open session's status in the sidebar's shapes; the spinner is left off the bar. */
  chatStatus: Exclude<ActivityState, 'running'> | null;
  onShowSettings: (tab?: string) => void;
};

// A fifth of a phone's width holds one short word, so long names get a bar label.
const BAR_LABEL_KEYS: Partial<Record<AppTab, string>> = { git: 'mobileNav.git' };

const CHAT_STATUS_LABEL_KEYS = {
  blocked: 'mobileNav.attention',
  unread: 'mobileNav.unread',
  scheduled: 'mobileNav.scheduled',
} as const;

const SLOT_TAB_STORAGE_KEY = 'mobile-nav-slot-tab';

const readStoredSlotTab = (): string | null => {
  try {
    return localStorage.getItem(SLOT_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
};

const barItemClassName = (isActive: boolean) =>
  cn(
    'flex h-full w-full touch-manipulation flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors disabled:opacity-40',
    isActive ? 'text-foreground' : 'text-muted-foreground',
  );

const indicatorClassName = (isActive: boolean) =>
  cn('relative flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-muted');

export default function MobileBottomNav({
  activeTab,
  hasSelectedProject,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  chatStatus,
  onShowSettings,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const {
    buttonRef: moreButtonRef,
    firstItemRef,
    isOpen: isMenuOpen,
    toggle: toggleMenu,
    open: openMenu,
    close: closeMenu,
  } = useMenuButton();
  const { handlers: slotLongPress } = useLongPress(openMenu, { disabled: !hasSelectedProject });

  const overflowTabs: TabDefinition[] = [
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
    ...getPluginTabs(plugins),
  ];
  const [storedSlotTab, setStoredSlotTab] = useState(readStoredSlotTab);
  const activeOverflowTab = overflowTabs.find((tab) => tab.id === activeTab);
  // An open overflow destination always owns the slot; otherwise the last pick, else the first entry.
  const slotTab = activeOverflowTab ?? overflowTabs.find((tab) => tab.id === storedSlotTab) ?? overflowTabs[0];
  const isSlotActive = slotTab !== undefined && slotTab.id === activeTab;

  const activeOverflowTabId = activeOverflowTab?.id;
  useEffect(() => {
    if (!activeOverflowTabId || activeOverflowTabId === storedSlotTab) return;
    setStoredSlotTab(activeOverflowTabId);
    try {
      localStorage.setItem(SLOT_TAB_STORAGE_KEY, activeOverflowTabId);
    } catch {
      // Storage unavailable; the pick lasts for this page load only.
    }
  }, [activeOverflowTabId, storedSlotTab]);

  const selectOverflowTab = (tab: AppTab) => {
    setActiveTab(tab);
    closeMenu();
  };

  return (
    <nav
      aria-label={t('mobileNav.label')}
      className="h-[var(--app-footer-height)] flex-shrink-0 border-t border-border/60 bg-background"
    >
      <ul className="flex h-full">
        {BASE_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const isDisabled = tab.id !== 'chat' && !hasSelectedProject;
          const status = tab.id === 'chat' && !isActive ? chatStatus : null;
          return (
            <li key={tab.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={isDisabled}
                title={isDisabled ? t('mobileNav.selectWorktreeFirst') : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={barItemClassName(isActive)}
              >
                <span className={indicatorClassName(isActive)}>
                  <tab.icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  {status === 'blocked' && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
                    >
                      <AlertCircle className="h-3 w-3 text-status-attention" />
                    </span>
                  )}
                  {status === 'unread' && (
                    <span
                      aria-hidden="true"
                      className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-status-unread ring-2 ring-background"
                    />
                  )}
                  {status === 'scheduled' && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
                    >
                      <Clock className="h-3 w-3 text-status-running" />
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate px-1">{t(BAR_LABEL_KEYS[tab.id] ?? tab.labelKey)}</span>
                {status && <span className="sr-only">{t(CHAT_STATUS_LABEL_KEYS[status])}</span>}
              </button>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          {slotTab ? (
            <button
              ref={moreButtonRef}
              type="button"
              disabled={!hasSelectedProject}
              title={!hasSelectedProject ? t('mobileNav.selectWorktreeFirst') : undefined}
              aria-current={isSlotActive ? 'page' : undefined}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              aria-description={t('mobileNav.swapHint')}
              // Tapping the open destination again is the visible route to the list; long-press is a shortcut.
              onClick={(event) => (isSlotActive ? toggleMenu(event) : setActiveTab(slotTab.id))}
              {...slotLongPress}
              className={barItemClassName(isSlotActive || isMenuOpen)}
            >
              <span className={indicatorClassName(isSlotActive)}>
                {slotTab.kind === 'builtin' ? (
                  <slotTab.icon className="h-5 w-5" strokeWidth={isSlotActive ? 2.2 : 1.8} aria-hidden="true" />
                ) : (
                  <PluginIcon
                    pluginName={slotTab.pluginName}
                    iconFile={slotTab.iconFile}
                    className="flex h-5 w-5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  />
                )}
                <ChevronUp className="absolute right-0.5 top-0 h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span className="max-w-full truncate px-1">
                {slotTab.kind === 'builtin' ? t(slotTab.labelKey) : slotTab.label}
              </span>
            </button>
          ) : (
            <button
              ref={moreButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={toggleMenu}
              className={barItemClassName(isMenuOpen)}
            >
              <span className={indicatorClassName(false)}>
                <Ellipsis className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="max-w-full truncate px-1">{t('mobileNav.more')}</span>
            </button>
          )}
        </li>
      </ul>

      {isMenuOpen && moreButtonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(moreButtonRef.current, { x: 0, y: 0 })}
          anchorElement={moreButtonRef.current}
          onDismiss={closeMenu}
          ariaLabel={t('mobileNav.moreMenu')}
          placement="above"
          maxHeight={MENU_LIST_MAX_HEIGHT}
          className={MENU_CLASS_NAME}
          measureKey={overflowTabs.length}
        >
          {overflowTabs.length === 0 ? (
            <>
              <div role="menuitem" aria-disabled="true" tabIndex={-1} className="px-3 py-2.5 text-sm text-muted-foreground">
                {t('mobileNav.noPlugins')}
              </div>
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onShowSettings('plugins');
                }}
                className={MENU_ITEM_CLASS_NAME}
              >
                <span className="h-4 w-4 flex-shrink-0" />
                <SettingsIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{t('mobileNav.pluginSettings')}</span>
              </button>
            </>
          ) : (
            overflowTabs.map((tab, index) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  ref={index === 0 ? firstItemRef : undefined}
                  type="button"
                  role="menuitem"
                  aria-current={isActive ? 'page' : undefined}
                  aria-disabled={!hasSelectedProject || undefined}
                  title={!hasSelectedProject ? t('mobileNav.selectWorktreeFirst') : undefined}
                  onClick={() => {
                    if (hasSelectedProject) selectOverflowTab(tab.id);
                  }}
                  className={cn(MENU_ITEM_CLASS_NAME, !hasSelectedProject && 'cursor-default opacity-40 hover:bg-transparent active:bg-transparent')}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {isActive && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                  </span>
                  {tab.kind === 'builtin' ? (
                    <tab.icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <PluginIcon
                      pluginName={tab.pluginName}
                      iconFile={tab.iconFile}
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-full [&>svg]:w-full"
                    />
                  )}
                  <span className={cn('truncate', isActive && 'font-medium')}>
                    {tab.kind === 'builtin' ? t(tab.labelKey) : tab.label}
                  </span>
                </button>
              );
            })
          )}
        </ContextMenuOverlay>
      )}
    </nav>
  );
}
