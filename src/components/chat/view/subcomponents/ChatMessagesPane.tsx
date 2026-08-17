import { useTranslation } from 'react-i18next';
import { memo, useCallback, useMemo } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import NextTaskBanner from '../../../task-master/view/NextTaskBanner';
import { getIntrinsicMessageKey, getTranscriptMessageUuid } from '../../utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '../../utils/toolGrouping';

import MessageComponent from './MessageComponent';
import ToolGroupContainer from './ToolGroupContainer';
import ChatExportMenu from './ChatExportMenu';

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  messagesContentRef: RefObject<HTMLDivElement>;
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
}

function ChatMessagesPane({
  scrollContainerRef,
  messagesContentRef,
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
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const nextTaskPrompt = t('tasks.nextTaskPrompt', {
    defaultValue: 'Start the next task',
  });
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
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
  const exportProvider = selectedSession?.__provider ?? provider;

  return (
    <div
      ref={scrollContainerRef}
      className="chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-3 sm:pb-4 sm:pt-4"
      style={{ overflowAnchor: 'none' }}
    >
      {chatMessages.length > 0 && (
        <div className="pointer-events-none sticky right-4 top-3 z-10 mb-2 flex justify-end sm:px-4">
          <div className="pointer-events-auto">
            <ChatExportMenu
              messages={chatMessages}
              sessionTitle={selectedSession?.title}
              assistantLabel={t(`messageTypes.${exportProvider}`, { defaultValue: exportProvider })}
              hasMoreMessages={hasMoreMessages}
              isLoadingAllMessages={isLoadingAllMessages}
              loadAllMessages={loadAllMessages}
            />
          </div>
        </div>
      )}
      <div
        ref={messagesContentRef}
        className={`mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4 ${
          chatMessages.length === 0 && (selectedSession || currentSessionId) ? 'h-full' : ''
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
        !selectedSession && !currentSessionId ? null : (
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
            <div className="flex items-center justify-center gap-2 border-b border-gray-200 py-2 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
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
      </div>
    </div>
  );
}

export default memo(ChatMessagesPane);
