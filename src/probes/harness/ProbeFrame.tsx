import { useMemo, useState, type ReactNode } from 'react';
import { Archive, Download, Pencil, Pin, Search, Trash2 } from 'lucide-react';

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
      { key: 'star', label: 'Pin', icon: Pin, onSelect: noop },
      { key: 'rename', label: 'Rename', icon: Pencil, onSelect: noop },
      { key: 'find', label: 'Find in Chat', icon: Search, onSelect: noop },
      { key: 'export', label: 'Export…', icon: Download, onSelect: noop },
      { key: 'archive', label: 'Archive', icon: Archive, onSelect: noop, showDividerBefore: true },
      { key: 'delete', label: 'Delete', icon: Trash2, onSelect: noop, isDanger: true },
    ],
    sessionIds: { appId: 'probe-session', providerId: null, provider: 'claude' },
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
