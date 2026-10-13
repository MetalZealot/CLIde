import { useTranslation } from 'react-i18next';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

import type { ScheduledMessage } from '../../hooks/useScheduledMessages';
import type { ChatMessage, PendingPermissionRequest, TurnEnd } from '../../types/types';
import type { Project, ProjectSession } from '../../../../types/app';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { FileOpenOptions } from '../../../code-editor/types/types';
import { useHasPendingSend } from '../../../../stores/sendOutbox';
import { useChatRows } from '../../hooks/useChatRows';

import ActivityIndicator from './ActivityIndicator';
import { ActivityLineSlot } from './ActivityLineSlot';
import ChatRows from './ChatRows';
import ScheduledMessageBubbles from './ScheduledMessageBubbles';

interface ChatMessagesPaneProps {
  scrollContainerRef: MutableRefObject<HTMLElement | null>;
  messagesContentRef: RefObject<HTMLDivElement>;
  /** The page scrolls instead of this pane (phones). */
  pageScroll?: boolean;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** The running turn's status, drawn as the conversation's last row. */
  activity?: SessionActivity | null;
  turnEnd?: TurnEnd | null;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  /** Prompt time of the turn the oldest loaded message belongs to, when that prompt is not loaded. */
  turnStartedAt?: string | null;
  /** That turn's output tokens from messages above the loaded ones. */
  turnOutputTokens?: number | null;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadAllMessages: () => Promise<ChatMessage[] | null>;
  isLoadingAllMessages: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown, options?: FileOpenOptions) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => {
    success: boolean;
  };
  showRawParameters?: boolean;
  showThinking?: boolean;
  /** A call waiting on one of these stays its own row until it is answered. */
  pendingPermissionRequests?: PendingPermissionRequest[];
  selectedProject: Project | null;
  onEditMessage?: (message: ChatMessage) => void;
  onEditUnsent?: (message: ChatMessage) => void;
  canEditMessage?: boolean;
  /** Base transcript uuid of the message loaded in the rewind-edit composer. */
  rewindEditTargetUuid?: string | null;
  /** The limit notice offering Auto-Continue, by identity in `chatMessages`. */
  liveLimitStopMessage?: ChatMessage | null;
  autoContinueEnabled?: boolean;
  /** Includes a reset message paused or held for editing. */
  hasResetMessage?: boolean;
  onSetAutoContinue?: (next: boolean) => void;
  /** Waiting to send, drawn after the last message; excludes one this client has open for editing. */
  scheduledMessages: ScheduledMessage[];
  onSendScheduledNow: (id: string) => void;
  onEditScheduledMessage: (message: ScheduledMessage) => void;
  onCancelScheduledMessage: (id: string) => void;
  onResumeScheduledMessage: (id: string) => void;
}

function ChatMessagesPane({
  scrollContainerRef,
  messagesContentRef,
  pageScroll = false,
  isLoadingSessionMessages,
  isProcessing = false,
  activity = null,
  turnEnd = null,
  chatMessages,
  selectedSession,
  currentSessionId,
  isLoadingMoreMessages,
  hasMoreMessages,
  turnStartedAt = null,
  turnOutputTokens = null,
  visibleMessageCount,
  visibleMessages,
  loadAllMessages,
  isLoadingAllMessages,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  pendingPermissionRequests,
  selectedProject,
  onEditMessage,
  onEditUnsent,
  canEditMessage = false,
  rewindEditTargetUuid = null,
  liveLimitStopMessage = null,
  autoContinueEnabled = false,
  hasResetMessage = false,
  onSetAutoContinue,
  scheduledMessages,
  onSendScheduledNow,
  onEditScheduledMessage,
  onCancelScheduledMessage,
  onResumeScheduledMessage,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  // Until the server confirms the send, the bubble's label tells the story; the run has not started.
  const sendPending = useHasPendingSend(selectedSession?.id || currentSessionId || null);
  const rows = useChatRows(visibleMessages, {
    chatMessages,
    isProcessing,
    showThinking,
    pendingPermissionRequests,
    turnStartedAt,
    turnOutputTokens,
  });
  const { items: groupedVisibleMessages, latestTurnReply } = rows;

  // Two frames: the first lays new rows out, then they may skip rendering. Until the
  // browser next decides what is on screen, an opted-in row lays out at its
  // placeholder, so that is its measured height: scroll restore reads in that gap.
  const laidOutMarkPendingRef = useRef(false);
  useLayoutEffect(() => {
    if (laidOutMarkPendingRef.current) return;
    laidOutMarkPendingRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      laidOutMarkPendingRef.current = false;
      const rows = Array.from(messagesContentRef.current?.children ?? []).filter(
        (row): row is HTMLElement => row instanceof HTMLElement
          && row.classList.contains('chat-message') && !row.hasAttribute('data-laid-out'),
      );
      // Every read precedes the writes: interleaving them lays the list out once per row.
      const heights = rows.map((row) => row.offsetHeight);
      rows.forEach((row, index) => {
        row.style.containIntrinsicHeight = `auto ${heights[index]}px`;
        row.setAttribute('data-laid-out', '');
      });
    }));
  }, [groupedVisibleMessages, messagesContentRef]);

  const attachScrollHost = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node && pageScroll ? document.documentElement : node;
    },
    [pageScroll, scrollContainerRef],
  );
  const fillsPane = chatMessages.length === 0
    && scheduledMessages.length === 0
    && Boolean(selectedSession || currentSessionId);

  return (
    <div
      ref={attachScrollHost}
      className={`chat-messages-pane relative pb-3 sm:pb-4 ${
        pageScroll
          ? 'flex flex-1 flex-col overflow-x-clip'
          : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
      }`}
      style={{ overflowAnchor: 'none' }}
    >
      {/* Gap, not space-y: a sibling selector restyles every row when older rows are prepended.
          Top padding sits here, not on the scroller, so an open row pins flush with the pane's edge. */}
      <div
        ref={messagesContentRef}
        className={`chat-rows mx-auto flex w-full max-w-[54.25rem] flex-col gap-3 px-4 pt-3 sm:gap-4 sm:pt-4 ${
          fillsPane ? (pageScroll ? 'flex-1' : 'h-full') : ''
        }`}
      >
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-muted-foreground">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        (!selectedSession && !currentSessionId) || scheduledMessages.length > 0 ? null : (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-[34.25rem] px-6 text-center">
              <p className="mb-1.5 text-lg font-semibold text-foreground">
                {t('session.continue.title')}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('session.continue.description')}
              </p>
            </div>
          </div>
        )
      ) : (
        <>
          {(hasMoreMessages || chatMessages.length > visibleMessageCount) && (
            <div className="flex select-none items-center justify-center gap-2 border-b border-border py-2 text-center text-chat-meta text-muted-foreground">
              {(isLoadingMoreMessages || isLoadingAllMessages) && (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400" />
              )}
              <span>
                {isLoadingAllMessages
                  ? t('session.messages.loadingAll')
                  : isLoadingMoreMessages
                    ? t('session.loading.olderMessages')
                    : t('session.messages.scrollToLoad')}
              </span>
              {!isLoadingMoreMessages && !isLoadingAllMessages && (
                <button
                  className="font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  onClick={loadAllMessages}
                >
                  {t('session.messages.loadAll')}
                </button>
              )}
            </div>
          )}

          <ChatRows
            rows={rows}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            onShowSettings={onShowSettings}
            onGrantToolPermission={onGrantToolPermission}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            selectedProject={selectedProject}
            onEditMessage={onEditMessage}
            onEditUnsent={onEditUnsent}
            canEditMessage={canEditMessage}
            rewindEditTargetUuid={rewindEditTargetUuid}
            liveLimitStopMessage={liveLimitStopMessage}
            autoContinueEnabled={autoContinueEnabled}
            hasResetMessage={hasResetMessage}
            onSetAutoContinue={onSetAutoContinue}
          />
        </>
      )}
      {!isLoadingSessionMessages && (
        <ActivityIndicator
          activity={sendPending ? null : activity}
          awaitingInput={(pendingPermissionRequests?.length ?? 0) > 0}
          turnEnd={sendPending ? null : turnEnd}
        />
      )}
      {!isLoadingSessionMessages && !latestTurnReply && (
        // No finished turn to carry the background-work mark, so it gets a row of its own.
        <div className="flex min-w-0 px-1 sm:px-0">
          <ActivityLineSlot kind="fallback" />
        </div>
      )}
      {!isLoadingSessionMessages && (
        <ScheduledMessageBubbles
          messages={scheduledMessages}
          canSendNow={!isProcessing}
          onSendNow={onSendScheduledNow}
          onEdit={onEditScheduledMessage}
          onCancel={onCancelScheduledMessage}
          onResume={onResumeScheduledMessage}
        />
      )}
      </div>
    </div>
  );
}

export default memo(ChatMessagesPane);
