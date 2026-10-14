import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  /** `<checkout> · <branch>` when the repository has several checkouts, else null. */
  checkoutLabel: string | null;
  /** The title opens the view's menu, so it carries a chevron. */
  hasMenu?: boolean;
};

function getTabTitle(activeTab: AppTab, t: (key: string) => string) {
  if (activeTab === 'terminal') {
    return t('tabs.terminal');
  }

  if (activeTab === 'shell') {
    return t('tabs.shell');
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

export function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

function TitleLine({ hasMenu, className, children }: { hasMenu: boolean; className: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <h2 className={`truncate font-semibold leading-tight text-foreground ${className}`}>{children}</h2>
      {hasMenu && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </div>
  );
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  checkoutLabel,
  hasMenu = false,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  // One sidebar row can cover several working trees (ADR 0016), so the project
  // name on its own does not say which one this is. The checkout label answers
  // that, and is absent for the ordinary single-checkout project.
  const subtitle = checkoutLabel ?? selectedProject.displayName;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <TitleLine hasMenu={hasMenu} className="text-sm">{getSessionTitle(selectedSession)}</TitleLine>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <TitleLine hasMenu={hasMenu} className="text-base">{t('mainContent.newSession')}</TitleLine>
            <div className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <TitleLine hasMenu={hasMenu} className="text-sm">{getTabTitle(activeTab, t)}</TitleLine>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
          </div>
        )}
      </div>
    </div>
  );
}
