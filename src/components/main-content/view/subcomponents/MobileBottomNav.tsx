import type { Dispatch, SetStateAction } from 'react';
import { Check, Ellipsis, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuOverlay, MENU_LIST_MAX_HEIGHT, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { AppTab } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';
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
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  /** A permission prompt is waiting in the chat. */
  chatNeedsAttention: boolean;
  onShowSettings: (tab?: string) => void;
};

// A fifth of a phone's width holds one short word, so long names get a bar label.
const BAR_LABEL_KEYS: Partial<Record<AppTab, string>> = { git: 'mobileNav.git' };

const barItemClassName = (isActive: boolean) =>
  cn(
    'flex h-full w-full touch-manipulation flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors',
    isActive ? 'text-foreground' : 'text-muted-foreground',
  );

const indicatorClassName = (isActive: boolean) =>
  cn('relative flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-muted');

export default function MobileBottomNav({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  chatNeedsAttention,
  onShowSettings,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const {
    buttonRef: moreButtonRef,
    firstItemRef,
    isOpen: isMenuOpen,
    toggle: toggleMenu,
    close: closeMenu,
  } = useMenuButton();

  const overflowTabs: TabDefinition[] = [
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
    ...getPluginTabs(plugins),
  ];
  const isOverflowActive = !BASE_TABS.some((tab) => tab.id === activeTab);

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
          const showAttention = tab.id === 'chat' && chatNeedsAttention && !isActive;
          return (
            <li key={tab.id} className="min-w-0 flex-1">
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={barItemClassName(isActive)}
              >
                <span className={indicatorClassName(isActive)}>
                  <tab.icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  {showAttention && (
                    <span
                      aria-hidden="true"
                      className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                    />
                  )}
                </span>
                <span className="max-w-full truncate px-1">{t(BAR_LABEL_KEYS[tab.id] ?? tab.labelKey)}</span>
                {showAttention && <span className="sr-only">{t('mobileNav.attention')}</span>}
              </button>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          <button
            ref={moreButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={toggleMenu}
            className={barItemClassName(isOverflowActive || isMenuOpen)}
          >
            <span className={indicatorClassName(isOverflowActive)}>
              <Ellipsis className="h-5 w-5" strokeWidth={isOverflowActive ? 2.2 : 1.8} aria-hidden="true" />
            </span>
            <span className="max-w-full truncate px-1">{t('mobileNav.more')}</span>
          </button>
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
                  onClick={() => selectOverflowTab(tab.id)}
                  className={MENU_ITEM_CLASS_NAME}
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
