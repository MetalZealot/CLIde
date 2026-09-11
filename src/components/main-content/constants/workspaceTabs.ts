import { ClipboardCheck, Folder, GitBranch, MessageSquare, MonitorPlay, Terminal, type LucideIcon } from 'lucide-react';

import type { Plugin } from '../../../contexts/PluginsContext';
import type { AppTab } from '../../../types/app';

export type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

export type PluginTab = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

export type TabDefinition = BuiltInTab | PluginTab;

export const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

export const BROWSER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};

export const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

export function getPluginTabs(plugins: Plugin[]): PluginTab[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin) => ({
      kind: 'plugin',
      id: `plugin:${plugin.name}` as AppTab,
      label: plugin.displayName,
      pluginName: plugin.name,
      iconFile: plugin.icon,
    }));
}
