import { BarChart3 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { useAuth } from '../../../auth/context/AuthContext';
import AccountAvatar from '../../../auth/view/AccountAvatar';

type SidebarAccountActionsProps = {
  onShowSettings: (screenId?: string) => void;
  onShowUsage: () => void;
  /** Icon-only actions for the collapsed rail. */
  isCompact?: boolean;
  t: TFunction;
};

export default function SidebarAccountActions({
  onShowSettings,
  onShowUsage,
  isCompact = false,
  t,
}: SidebarAccountActionsProps) {
  const { user } = useAuth();
  const username = user?.username ?? '';
  const settingsLabel = t('actions.settings');
  const usageLabel = t('common:usageDashboard.title', 'Usage');
  const compactButtonClassName =
    'group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80 active:bg-accent/80';

  if (isCompact) {
    return (
      <>
        <button
          type="button"
          onClick={onShowUsage}
          aria-label={usageLabel}
          title={usageLabel}
          className={compactButtonClassName}
        >
          <BarChart3 className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
        </button>
        <button
          type="button"
          onClick={() => onShowSettings()}
          aria-label={settingsLabel}
          title={settingsLabel}
          className={compactButtonClassName}
        >
          <AccountAvatar avatar={user?.avatar} username={username} className="h-7 w-7 text-xs" />
        </button>
      </>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onShowSettings()}
        aria-label={settingsLabel}
        title={settingsLabel}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent/60 active:bg-accent/60"
      >
        <AccountAvatar avatar={user?.avatar} username={username} className="h-7 w-7 text-xs" />
      </button>
      <button
        type="button"
        onClick={onShowUsage}
        aria-label={usageLabel}
        title={usageLabel}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent/60 active:bg-accent/60"
      >
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
      </button>
    </div>
  );
}
