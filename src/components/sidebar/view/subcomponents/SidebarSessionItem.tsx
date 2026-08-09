import { useEffect, useRef } from 'react';
import { Check, Edit2, GitBranch, Loader2, Pin, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Tooltip, buttonVariants, anchorFromElement, type ContextMenuAnchor } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import { useLongPress } from '../../../../hooks/useLongPress';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  /** Finished output the user hasn't opened yet (green); no action required. */
  isUnread: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  /** Shown under the session name in flat lists that mix projects. */
  projectLabel?: string;
  /**
   * Checkout this session runs in, shown under the title when its repository
   * row merges several checkouts (ADR 0016). Null when there is nothing to
   * disambiguate.
   */
  branchLabel?: string | null;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  /** Opens the mobile long-press action menu, anchored to this row. */
  onLongPressMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  activeContextMenuKey?: string | null;
  t: TFunction;
};

/**
 * Compact relative time for sidebar rows:
 * <1m, Xm, Xhr, Xd.
 */
const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }

  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  isUnread,
  currentTime,
  editingSession,
  editingSessionName,
  projectLabel,
  branchLabel,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onLongPressMenu,
  activeContextMenuKey,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const isStarred = Boolean(session.isStarred);
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  // Shares the metadata line with the message-count badge rather than claiming a
  // line of its own, so a merged repository row is no taller per session.
  const branchBadge = branchLabel ? (
    <span
      className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/70"
      title={branchLabel}
    >
      <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
      <span className="truncate">{branchLabel}</span>
    </span>
  ) : null;
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const mobileEditRef = useRef<HTMLDivElement>(null);
  // Anchor the menu to the row's box, not the finger, so it opens attached to
  // the session it acts on.
  const mobileRowRef = useRef<HTMLDivElement>(null);
  const { handlers: longPress, isPressing } = useLongPress(
    (coords) => onLongPressMenu?.(session, anchorFromElement(mobileRowRef.current, coords)),
    { disabled: !onLongPressMenu },
  );
  // Stays on for as long as this row's menu is open.
  const isContextActive = isPressing || activeContextMenuKey === `session:${session.id}`;
  // Needs-action (amber) is only meaningful when you're not already viewing it.
  const needsAttentionHighlight = needsAttention && !isSelected;
  // Unread (green) yields to needs-action and to an in-progress run.
  const unreadHighlight = isUnread && !isSelected && !needsAttention && !isProcessing;

  // The rename panel sits inside a group-hover opacity wrapper, so leaving the row
  // would visually hide it. While editing, dismiss only when the user clicks outside
  // the panel (matches Escape / cancel-button behaviour).
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideDesktop = editingContainerRef.current?.contains(target);
      const insideMobile = mobileEditRef.current?.contains(target);
      if (!insideDesktop && !insideMobile) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  return (
    <div className="group relative">
      <div className="md:hidden">
        {isEditing ? (
          <div
            ref={mobileEditRef}
            className="my-0.5 ml-1 mr-3 flex items-center gap-1 rounded-md border border-primary/50 bg-card p-2"
          >
            <input
              type="text"
              value={editingSessionName}
              onChange={(event) => onEditingSessionNameChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  saveEditedSession();
                } else if (event.key === 'Escape') {
                  onCancelEditingSession();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              // 16px keeps iOS Safari from zooming the viewport on focus.
              style={{ fontSize: '16px', WebkitAppearance: 'none' }}
              autoFocus
              autoComplete="off"
            />
            <button
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-green-500 active:scale-90 dark:bg-green-600"
              onClick={(event) => {
                event.stopPropagation();
                saveEditedSession();
              }}
              title={t('tooltips.save')}
            >
              <Check className="h-4 w-4 text-white" />
            </button>
            <button
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-gray-500 active:scale-90 dark:bg-gray-600"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingSession();
              }}
              title={t('tooltips.cancel')}
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>
        ) : (
          <div
            ref={mobileRowRef}
            className={cn(
              // No resting card: every reference client in `docs/ui ref/` shows
              // a row's surface only while it is pressed, hovered, or current.
              // A tint alone carries the status states — the border was what
              // made a dense list read as a stack of boxes.
              // Match the action row's left edge and keep its right gutter.
              // The parent rail still makes these read as nested sessions.
              'long-pressable p-2 ml-1 mr-3 my-0.5 rounded-md transition-all duration-150 relative',
              isContextActive && 'scale-[0.98] bg-accent/60',
              // Single chain: a trailing fallback would win inside cn()
              // (tailwind-merge keeps the last conflicting class) and erase the
              // selected fill.
              isSelected
                ? 'bg-primary/10'
                : needsAttentionHighlight
                ? 'bg-amber-500/10'
                : isProcessing
                ? 'bg-muted/40'
                : unreadHighlight
                ? 'bg-green-500/10'
                : 'active:bg-accent/50',
            )}
            onClick={selectMobileSession}
            {...longPress}
          >
            <div className="min-w-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {isStarred && (
                    <Pin className="h-3 w-3 flex-shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                  {isProcessing ? (
                    <span className="ml-auto flex-shrink-0">
                      <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </span>
                      </Tooltip>
                    </span>
                  ) : compactSessionAge && (
                    <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {sessionView.messageCount > 0 && (
                    <Badge variant="secondary" className="px-1 py-0 text-xs">
                      {sessionView.messageCount}
                    </Badge>
                  )}
                  {projectLabel && (
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">{projectLabel}</span>
                  )}
                  {branchBadge}
                  <span className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hidden md:block">
        <a
          href={`/session/${session.id}`}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            // Surface on hover or when current, never at rest — see the mobile
            // row above for why the resting card and border are gone.
            'h-auto w-full justify-start rounded-md p-2 text-left font-normal transition-all duration-150',
            isSelected ? 'bg-primary/10' : null,
            needsAttentionHighlight
              ? 'bg-amber-500/10 hover:bg-amber-500/20'
              : !isSelected && isProcessing
                ? 'bg-muted/40 hover:bg-muted/50'
                : unreadHighlight
                  ? 'bg-green-500/10 hover:bg-green-500/20'
                  : 'hover:bg-accent/50',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
          // native right-click menu use the href to open a new tab/window.
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
        >
          <div className="w-full min-w-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {isStarred && (
                  <Pin className="h-3 w-3 flex-shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                {isProcessing ? (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-xs">{sessionView.messageCount}</Badge>}
                {projectLabel && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">{projectLabel}</span>
                )}
                {branchBadge}
                <span className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </a>

        <div
          ref={editingContainerRef}
          className={cn(
            'absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 transition-all duration-200',
            isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
                {!isProcessing && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteSession();
                    }}
                    title={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
                  >
                    <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                  </button>
                )}
              </>
            )}
          </div>
      </div>
    </div>
  );
}
