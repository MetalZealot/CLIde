import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';
import {
  BASE_TABS,
  BROWSER_TAB,
  getPluginTabs,
  type TabDefinition,
} from '../../constants/workspaceTabs';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowBrowserTab: boolean;
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowBrowserTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const tabs: TabDefinition[] = [
    ...BASE_TABS,
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...getPluginTabs(plugins),
  ];

  return (
    <PillBar>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="px-2.5 py-[5px]"
            >
              {tab.kind === 'builtin' ? (
                <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              ) : (
                <PluginIcon
                  pluginName={tab.pluginName}
                  iconFile={tab.iconFile}
                  className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                />
              )}
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}
