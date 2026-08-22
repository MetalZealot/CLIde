import { MessageSquarePlus, Sparkles, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { ActivitySummary } from '../../types/types';

import SidebarAccountMenu from './SidebarAccountMenu';
import SidebarStatusIndicator from './SidebarStatusIndicator';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onOpenNewSession: () => void;
  onShowSettings: (screenId?: string) => void;
  onShowUsage: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  activitySummary: ActivitySummary;
  onShowVersionModal: () => void;
  t: TFunction;
};

/**
 * The rail mirrors the expanded sidebar's spine: New Session at the top where
 * the header carries it, identity at the bottom where the footer does, and any
 * update banner directly above that identity. Settings is not repeated here —
 * it lives inside the account menu, the same as when expanded.
 */
export default function SidebarCollapsed({
  onExpand,
  onOpenNewSession,
  onShowSettings,
  onShowUsage,
  updateAvailable,
  restartRequired,
  activitySummary,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  const activityState = activitySummary.blocked > 0
    ? 'blocked'
    : activitySummary.running > 0
      ? 'running'
      : activitySummary.unread > 0
        ? 'unread'
        : null;

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

      {/* New Session */}
      <button
        onClick={onOpenNewSession}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('sessions.newSession')}
        title={t('sessions.newSession')}
      >
        <MessageSquarePlus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Highest-urgency transient activity, matching the expanded summary. */}
      {activityState && (
        <SidebarStatusIndicator
          status={activityState}
          t={t}
          size="md"
          labelPrefix={t('projects.activity')}
        />
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

      <div className="flex-1" />

      {/* Update indicator, directly above the account icon it precedes when expanded */}
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

      <SidebarAccountMenu
        isCompact
        onShowSettings={onShowSettings}
        onShowUsage={onShowUsage}
        t={t}
      />
    </div>
  );
}
