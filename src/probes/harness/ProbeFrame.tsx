import { useMemo, useState, type ReactNode } from 'react';
import { Archive, Download, Pin, Search, SquareTerminal, Trash2 } from 'lucide-react';

import { HeaderMenuProvider, useRegisterHeaderMenu, type HeaderMenuSection } from '../../contexts/HeaderMenuContext';
import MainContentHeader from '../../components/main-content/view/subcomponents/MainContentHeader';
import MobileBottomNav from '../../components/main-content/view/subcomponents/MobileBottomNav';
import type { AppTab, Project, ProjectSession } from '../../types/app';

import ProbeComposer from './ProbeComposer';
import type { ProbeFrameOptions } from './types';

const PROJECT: Project = {
  projectId: 'probe-project',
  displayName: 'cloudcli',
  fullPath: '/probe/cloudcli',
  path: '/probe/cloudcli',
};

const noop = () => {};

/** Inert copy of the chat kebab's items, so the header shows its menu button. */
function ProbeHeaderMenu() {
  const section = useMemo<HeaderMenuSection>(() => ({
    items: [
      { key: 'star', label: 'Pin', icon: Pin, sheetLayout: 'tile', onSelect: noop },
      { key: 'find', label: 'Find in Chat', shortLabel: 'Find', icon: Search, sheetLayout: 'tile', onSelect: noop },
      { key: 'export', label: 'Export…', shortLabel: 'Export', icon: Download, sheetLayout: 'tile', onSelect: noop },
      { key: 'open-in-cli', label: 'Open in CLI', shortLabel: 'CLI', icon: SquareTerminal, sheetLayout: 'tile', onSelect: noop },
      { key: 'archive', label: 'Archive', icon: Archive, sheetLayout: 'half', onSelect: noop, showDividerBefore: true },
      { key: 'delete', label: 'Delete', icon: Trash2, sheetLayout: 'half', onSelect: noop, isDanger: true },
    ],
    sessionIds: { appId: 'probe-session', providerId: null, provider: 'claude' },
    rename: { name: '', submit: noop },
  }), []);
  useRegisterHeaderMenu(section);
  return null;
}

/** CLIde's real mobile chrome on fake data, with the probe's content above the composer. */
export default function ProbeFrame({ options, children }: { options?: ProbeFrameOptions; children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<AppTab>(options?.tab ?? 'chat');
  const session: ProjectSession = {
    id: 'probe-session',
    summary: options?.sessionTitle ?? 'Probe session',
    provider: 'claude',
    __provider: 'claude',
  };

  return (
    <HeaderMenuProvider>
      <ProbeHeaderMenu />
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {!options?.hideHeader && (
          <MainContentHeader
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedProject={PROJECT}
            selectedSession={session}
            checkoutLabel={null}
            shouldShowBrowserTab={false}
            isMobile
            onMenuClick={noop}
            otherSessionsStatus={null}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
          {!options?.hideComposer && <ProbeComposer />}
        </div>
        {!options?.hideNav && (
          <MobileBottomNav
            activeTab={activeTab}
            hasSelectedProject
            setActiveTab={setActiveTab}
            shouldShowBrowserTab={false}
            chatStatus={null}
          />
        )}
      </div>
    </HeaderMenuProvider>
  );
}
