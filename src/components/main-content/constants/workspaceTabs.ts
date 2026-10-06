import { Folder, GitBranch, MessageSquare, MonitorPlay, Terminal, type LucideIcon } from 'lucide-react';

import type { AppTab } from '../../../types/app';

export type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

export const BASE_TABS: TabDefinition[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
  { id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

export const BROWSER_TAB: TabDefinition = {
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};
