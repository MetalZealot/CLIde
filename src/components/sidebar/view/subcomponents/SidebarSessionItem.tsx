import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, Folder, Pin, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  Badge,
  buttonVariants,
  anchorFromElement,
  RowActionsTrigger,
  type ContextMenuAnchor,
} from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel, resolveActivityState } from '../../utils/utils';
import { projectAccentColorValue, type ProjectAccentColor } from '../../utils/accentColors';
import { useLongPress } from '../../../../hooks/useLongPress';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

import SidebarStatusIndicator from './SidebarStatusIndicator';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  /** Output the user hasn't opened yet; no action required. */
  isUnread: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  /** Shown above the session name in flat lists that mix projects. */
  projectLabel?: string;
  /** Repository identity marker for a standalone row in the flat Sessions view. */
  accentColor?: ProjectAccentColor | null;
  /** Global Activity/Pinned rows align with repository headers, not nested sessions. */
  isSectionItem?: boolean;
  /**
   * Checkout this session runs in, shown under the title when its repository
   * row merges several checkouts (ADR 0016). Null when there is nothing to
   * disambiguate.
   */
  checkoutLabel?: string | null;
  onEditingSessionNameChange: (value: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  /**
   * Opens this row's action menu, anchored to the row (long-press) or to the
   * kebab that was clicked. One menu, several ways in.
   */
  onOpenActionsMenu?: (session: SessionWithProvider, anchor: ContextMenuAnchor) => void;
  activeContextMenuKey?: string | null;
  /**
   * Batch mode: the row becomes a checkbox. Navigation, rename, and the actions
   * menu are all suspended, so a tap can only ever tick or untick.
   */
  isSelectionMode?: boolean;
  isBatchSelected?: boolean;
  onToggleBatchSelected?: (sessionId: string) => void;
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
  accentColor = null,
  isSectionItem = false,
  checkoutLabel,
  onEditingSessionNameChange,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onOpenActionsMenu,
  activeContextMenuKey,
  isSelectionMode = false,
  isBatchSelected = false,
  onToggleBatchSelected,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id && !isSelectionMode;
  const isStarred = Boolean(session.isStarred);
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  // Shares the metadata line with the message-count badge rather than claiming a
  // line of its own, so a merged repository row is no taller per session.
  // ADR 0016: a checkout and a branch never share an icon, and this badge names
  // the folder.
  const checkoutBadge = checkoutLabel ? (
    <span
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      title={checkoutLabel}
    >
      <Folder className="h-2.5 w-2.5 flex-shrink-0" />
      <span className="truncate">{checkoutLabel}</span>
    </span>
  ) : null;
  // Repository above the title, checkout below it: the row reads place, then
  // subject, then which tree it ran in. Nested rows never get the prop, because
  // the enclosing repository row already says it.
  const projectEyebrow = projectLabel ? (
    <div className="min-w-0 truncate text-xs text-muted-foreground" title={projectLabel}>
      {projectLabel}
    </div>
  ) : null;
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const mobileEditRef = useRef<HTMLDivElement>(null);
  // Anchor the menu to the row's box, not the finger, so it opens attached to
  // the session it acts on.
  const mobileRowRef = useRef<HTMLDivElement>(null);
  const { handlers: longPress, isPressing } = useLongPress(
    (coords) => onOpenActionsMenu?.(session, anchorFromElement(mobileRowRef.current, coords)),
    { disabled: !onOpenActionsMenu || isSelectionMode },
  );
  const isMenuOpen = activeContextMenuKey === `session:${session.id}`;
  // Stays on for as long as this row's menu is open.
  const isContextActive = isPressing || isMenuOpen;
  const activityState = resolveActivityState({ isProcessing, needsAttention, isUnread });
  const toggleBatchSelected = () => onToggleBatchSelected?.(session.id);
  // The trailing slot yields to whatever replaces it. Batch mode replaces it
  // with nothing, so it must stay put.
  const trailingFadeClass = isEditing
    ? 'opacity-0'
    : isSelectionMode ? undefined : 'group-hover:opacity-0';

  // Flat Sessions-view rows stand alone, so they repeat the repository strip.
  // Nested Projects-view rows omit this prop because the enclosing rail already
  // carries the same identity.
  const accentStrip = accentColor && (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 w-1"
      style={{ backgroundColor: projectAccentColorValue(accentColor) }}
    />
  );

  // Leading tick box, shown only in batch mode so ordinary rows keep their full
  // width for the title.
  const selectionBox = isSelectionMode && (
    <span
      aria-hidden
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
        isBatchSelected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/50',
      )}
    >
      {isBatchSelected && <Check className="h-3 w-3" />}
    </span>
  );

  const openSessionMenuAtCursor = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onOpenActionsMenu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenActionsMenu(session, {
      top: event.clientY,
      bottom: event.clientY,
      left: event.clientX,
    });
  };

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

  return (
    <div className="group relative">
      <div className="md:hidden">
        {isEditing ? (
          <div
            ref={mobileEditRef}
            className="my-[3px] ml-1 mr-3 flex items-center gap-1 rounded-md border border-primary/50 bg-card px-3 py-2"
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
            role={isSelectionMode ? 'checkbox' : undefined}
            aria-checked={isSelectionMode ? isBatchSelected : undefined}
            aria-label={isSelectionMode ? sessionView.sessionName : undefined}
            className={cn(
              // No resting card: the row surface belongs to interaction and
              // selection; transient state has its own symbol slot.
              // Global Activity/Pinned rows share repository headers' gutter;
              // sessions beneath a repository remain visibly nested.
              // Matches the repository header's px-3 so labels down the whole
              // sidebar share one text edge instead of two by a few pixels.
              'long-pressable relative my-[3px] overflow-hidden rounded-md px-3 py-2 transition-all duration-150',
              isSectionItem ? 'mx-3' : 'ml-2 mr-3',
              isContextActive && 'scale-[0.98] bg-accent/60',
              isBatchSelected
                ? 'bg-primary/20'
                : isSelected ? 'bg-primary/15' : 'active:bg-accent/50',
            )}
            onClick={isSelectionMode ? toggleBatchSelected : selectMobileSession}
            {...longPress}
          >
            {accentStrip}
            <div className="min-w-0">
              <div className="min-w-0 flex-1">
                {projectEyebrow}
                <div className="flex items-center gap-1.5">
                  {selectionBox}
                  {isStarred && (
                    <Pin className="h-3 w-3 flex-shrink-0 text-primary" />
                  )}
                  <div
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm text-foreground',
                      // Weight is the scarcest signal in a 30-row list, so it
                      // marks state only. Level is carried by the repository
                      // row's `font-medium` and by the rail's indent.
                      isUnread ? 'font-medium' : 'font-normal',
                    )}
                  >
                    {sessionView.sessionName}
                  </div>
                  {activityState ? (
                    <SidebarStatusIndicator status={activityState} t={t} className="ml-auto" />
                  ) : compactSessionAge && (
                    <span className="ml-auto flex-shrink-0 text-xs text-muted-foreground">{compactSessionAge}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {sessionView.messageCount > 0 && (
                    <Badge variant="secondary" className="px-1 py-0 text-xs">
                      {sessionView.messageCount}
                    </Badge>
                  )}
                  {checkoutBadge}
                  <span className="ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center">
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
          // Batch mode drops the href: the row is a tick box, and a modified
          // click must not open a session the user is only selecting.
          href={isSelectionMode ? undefined : `/session/${session.id}`}
          role={isSelectionMode ? 'checkbox' : undefined}
          aria-checked={isSelectionMode ? isBatchSelected : undefined}
          tabIndex={isSelectionMode ? 0 : undefined}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            // Surface on hover or when current; status stays in its symbol slot.
            'relative h-auto w-full overflow-hidden justify-start rounded-md px-3 py-2 text-left font-normal transition-all duration-150',
            isBatchSelected
              ? 'bg-primary/20'
              : isSelected ? 'bg-primary/15' : 'hover:bg-accent/50',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click use the
          // href, while right-click opens the row actions at the cursor.
          onClick={(event) => {
            if (isSelectionMode) {
              event.preventDefault();
              toggleBatchSelected();
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
          onKeyDown={(event) => {
            if (!isSelectionMode) return;
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              toggleBatchSelected();
            }
          }}
          onContextMenu={isSelectionMode ? undefined : openSessionMenuAtCursor}
        >
          {accentStrip}
          <div className="w-full min-w-0">
            <div className="min-w-0 flex-1">
              {projectEyebrow}
              <div className="flex items-center gap-1.5">
                {selectionBox}
                {isStarred && (
                  <Pin className="h-3 w-3 flex-shrink-0 text-primary" />
                )}
                <div
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm text-foreground',
                      // Weight is the scarcest signal in a 30-row list, so it
                      // marks state only. Level is carried by the repository
                      // row's `font-medium` and by the rail's indent.
                      isUnread ? 'font-medium' : 'font-normal',
                    )}
                  >
                    {sessionView.sessionName}
                  </div>
                {activityState ? (
                  <SidebarStatusIndicator
                    status={activityState}
                    t={t}
                    className={cn('ml-auto transition-opacity duration-200', trailingFadeClass)}
                  />
                ) : compactSessionAge && (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 text-xs text-muted-foreground transition-opacity duration-200',
                      trailingFadeClass,
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-xs">{sessionView.messageCount}</Badge>}
                {checkoutBadge}
                <span className="ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </a>

        {/*
          No opacity on this container: the kebab owns its own hover/focus
          reveal, and a parent stuck at `opacity-0` would swallow the
          `focus-visible` escape that keeps it reachable from the keyboard.
        */}
        <div
          ref={editingContainerRef}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1"
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
              onOpenActionsMenu && !isSelectionMode && (
                <RowActionsTrigger
                  label={t('actions.rowActions', 'Actions for {{name}}', { name: sessionView.sessionName })}
                  isOpen={isMenuOpen}
                  onOpen={(anchor) => onOpenActionsMenu(session, anchor)}
                />
              )
            )}
          </div>
      </div>
    </div>
  );
}
