import { Activity, Loader2, Settings, Sparkles, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ActivitySummary } from '../../types/types';
import { cn } from '../../../../lib/utils';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  activitySummary: ActivitySummary;
  onShowVersionModal: () => void;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  updateAvailable,
  restartRequired,
  activitySummary,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  const activityState = activitySummary.blocked > 0
    ? 'blocked'
    : activitySummary.unread > 0
      ? 'unread'
      : activitySummary.running > 0
        ? 'running'
        : null;
  const activityLabel = activityState === 'blocked'
    ? t('projects.activityBlocked', 'Blocked')
    : activityState === 'unread'
      ? t('projects.activityUnread', 'Unread finished')
      : t('projects.activityRunning', 'Running');
  const ActivityIcon = activityState === 'running' ? Loader2 : Activity;

  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="nav-divider my-1 w-6" />

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Highest-urgency transient activity, matching the expanded summary. */}
      {activityState && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={`${t('projects.activity')}: ${activityLabel}`}
          title={`${t('projects.activity')}: ${activityLabel}`}
        >
          <ActivityIcon
            className={cn(
              'h-4 w-4',
              activityState === 'blocked' && 'text-amber-500',
              activityState === 'unread' && 'text-green-500',
              activityState === 'running' && 'animate-spin text-muted-foreground',
            )}
          />
          <span
            className={cn(
              'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
              activityState === 'blocked' && 'bg-amber-500',
              activityState === 'unread' && 'bg-green-500',
              activityState === 'running' && 'animate-pulse bg-muted-foreground',
            )}
          />
        </div>
      )}

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        </div>
      )}

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-blue-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        </button>
      )}
    </div>
  );
}
