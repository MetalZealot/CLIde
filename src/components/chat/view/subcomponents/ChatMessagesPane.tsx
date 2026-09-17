import { useTranslation } from 'react-i18next';
import { memo, useCallback, useMemo } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

import type { ScheduledMessage } from '../../hooks/useScheduledMessages';
import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import NextTaskBanner from '../../../task-master/view/NextTaskBanner';
import { getIntrinsicMessageKey, getTranscriptMessageUuid } from '../../utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '../../utils/toolGrouping';
import { computeTurnDurations } from '../../utils/turnDuration';

import MessageComponent from './MessageComponent';
import ScheduledMessageBubbles from './ScheduledMessageBubbles';
import ToolGroupContainer from './ToolGroupContainer';

interface ChatMessagesPaneProps {
  scrollContainerRef: MutableRefObject<HTMLElement | null>;
  messagesContentRef: RefObject<HTMLDivElement>;
  /** The page scrolls instead of this pane (phones). */
  pageScroll?: boolean;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  /** Prompt time of the turn the oldest loaded message belongs to, when that prompt is not loaded. */
  turnStartedAt?: string | null;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadAllMessages: () => Promise<ChatMessage[] | null>;
  isLoadingAllMessages: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => {
    success: boolean;
  };
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project | null;
  onEditMessage?: (message: ChatMessage) => void;
  canEditMessage?: boolean;
  /** Base transcript uuid of the message loaded in the rewind-edit composer. */
  rewindEditTargetUuid?: string | null;
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
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  turnStartedAt = null,
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
  selectedProject,
  onEditMessage,
  canEditMessage = false,
  rewindEditTargetUuid = null,
  scheduledMessages,
  onSendScheduledNow,
  onEditScheduledMessage,
  onCancelScheduledMessage,
  onResumeScheduledMessage,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const nextTaskPrompt = t('tasks.nextTaskPrompt', {
    defaultValue: 'Start the next task',
  });
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );
  // All loaded messages, so a turn whose prompt sits above the visible window still resolves.
  const turnDurations = useMemo(
    () => computeTurnDurations(chatMessages, isProcessing, turnStartedAt),
    [chatMessages, isProcessing, turnStartedAt],
  );

  // Stable, deterministic keys for the messages rendered this pass.
  //
  // `normalizedToChatMessages` rebuilds fresh ChatMessage objects on every store
  // update, so caching keys by object identity (or via a cross-render allocation
  // Set) minted a brand-new key for the *same* logical message on each prepend —
  // remounting the whole list, which disconnects the scroll-restore anchor and
  // reflows heights, jumping the viewport to the bottom. Deriving keys purely
  // from this render's ordered messages (intrinsic key, disambiguated by
  // occurrence index on collision) yields the same key for the same message
  // order, so React preserves existing DOM nodes and component state on prepend.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    for (const item of groupedVisibleMessages) {
      if (isToolGroupItem(item)) {
        item.messages.forEach(assign);
      } else {
        assign(item);
      }
    }
    return keys;
  }, [groupedVisibleMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) => messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );

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
      className={`chat-messages-pane relative pb-3 pt-3 sm:pb-4 sm:pt-4 ${
        pageScroll
          ? 'flex flex-1 flex-col overflow-x-clip'
          : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
      }`}
      style={{ overflowAnchor: 'none' }}
    >
      <div
        ref={messagesContentRef}
        className={`mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4 ${
          fillsPane ? (pageScroll ? 'flex-1' : 'h-full') : ''
        }`}
      >
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
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
              {tasksEnabled && isTaskMasterInstalled && (
                <div className="mt-5">
                  <NextTaskBanner
                    onStartTask={() => setInput(nextTaskPrompt)}
                    onShowAllTasks={onShowAllTasks}
                  />
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        <>
          {(hasMoreMessages || chatMessages.length > visibleMessageCount) && (
            <div className="flex select-none items-center justify-center gap-2 border-b border-gray-200 py-2 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
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

          {(() => {
            let prevMessage: ChatMessage | null = null;

            return groupedVisibleMessages.map((item) => {
              if (isToolGroupItem(item)) {
                const groupPrevMessage = prevMessage;
                prevMessage = item.messages[item.messages.length - 1] || prevMessage;

                return (
                  <ToolGroupContainer
                    key={`tool-group-${getMessageKey(item.messages[0])}`}
                    group={item}
                    prevMessage={groupPrevMessage}
                    createDiff={createDiff}
                    getMessageKey={getMessageKey}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    onGrantToolPermission={onGrantToolPermission}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject as Project}
                    provider={provider}
                  />
                );
              }

              const messagePrevMessage = prevMessage;
              prevMessage = item;

              return (
                <MessageComponent
                  key={getMessageKey(item)}
                  message={item}
                  prevMessage={messagePrevMessage}
                  turnDurationMs={turnDurations.get(item)}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject as Project}
                  provider={provider}
                  onEditMessage={onEditMessage}
                  canEditMessage={canEditMessage}
                  isRewindEditTarget={
                    rewindEditTargetUuid !== null &&
                    item.type === 'user' &&
                    getTranscriptMessageUuid(item.id) === rewindEditTargetUuid
                  }
                />
              );
            });
          })()}
        </>
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
