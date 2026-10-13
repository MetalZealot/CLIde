import type { ComponentProps } from 'react';

import type { ChatMessage } from '../../types/types';
import type { FileOpenOptions } from '../../../code-editor/types/types';
import type { ChatRowsModel } from '../../hooks/useChatRows';
import { getTranscriptMessageUuid } from '../../utils/messageKeys';
import { isToolActivityItem } from '../../utils/toolGrouping';
import ChatBrowserActivity from '../../../browser-use/view/ChatBrowserActivity';

import MessageComponent from './MessageComponent';
import SubagentActivity from './SubagentActivity';
import ToolActivity from './ToolActivity';

type MessageProps = ComponentProps<typeof MessageComponent>;

interface ChatRowsProps extends Pick<MessageProps,
  'createDiff' | 'onShowSettings' | 'onGrantToolPermission' | 'showRawParameters' | 'showThinking'
  | 'selectedProject' | 'onEditMessage' | 'onEditUnsent' | 'canEditMessage'
  | 'autoContinueEnabled' | 'hasResetMessage' | 'onSetAutoContinue'> {
  rows: ChatRowsModel;
  onFileOpen?: (filePath: string, diffInfo?: unknown, options?: FileOpenOptions) => void;
  /** Base transcript uuid of the message loaded in the rewind-edit composer. */
  rewindEditTargetUuid?: string | null;
  /** The limit notice offering Auto-Continue, by identity in the messages. */
  liveLimitStopMessage?: ChatMessage | null;
}

/** One element per row: an activity, a browser card, a subagent, or a message. */
export default function ChatRows({
  rows,
  onFileOpen,
  rewindEditTargetUuid = null,
  liveLimitStopMessage = null,
  autoContinueEnabled,
  hasResetMessage,
  onSetAutoContinue,
  ...messageProps
}: ChatRowsProps) {
  const { items, isProcessing, pendingToolIds, liveActivity, turnSummaries, latestTurnReply, getMessageKey, activityKeys } = rows;
  let prevMessage: ChatMessage | null = null;

  return (
    <>
      {items.map((item) => {
        if (isToolActivityItem(item)) {
          const activityPrevMessage = prevMessage;
          prevMessage = item.messages[item.messages.length - 1] || prevMessage;

          if (item.browser) {
            return (
              <ChatBrowserActivity
                key={activityKeys.keys.get(item)}
                activity={item}
                isLive={item === liveActivity}
                getMessageKey={getMessageKey}
                onFileOpen={onFileOpen}
              />
            );
          }

          return (
            <ToolActivity
              key={activityKeys.keys.get(item)}
              activity={item}
              previous={activityPrevMessage}
              isLive={item === liveActivity}
              isWaiting={item.messages.length === 1 && Boolean(item.messages[0].toolId && pendingToolIds.has(item.messages[0].toolId))}
              getMessageKey={getMessageKey}
              onFileOpen={onFileOpen}
            />
          );
        }

        const messagePrevMessage = prevMessage;
        prevMessage = item;

        if (item.isSubagentContainer) {
          return (
            <SubagentActivity
              key={getMessageKey(item)}
              message={item}
              isLive={isProcessing}
              onFileOpen={onFileOpen}
            />
          );
        }

        return (
          <MessageComponent
            key={getMessageKey(item)}
            {...messageProps}
            message={item}
            prevMessage={messagePrevMessage}
            turnSummary={turnSummaries.get(item)}
            isLatestTurn={item === latestTurnReply}
            onFileOpen={onFileOpen}
            isRewindEditTarget={
              rewindEditTargetUuid !== null &&
              item.type === 'user' &&
              getTranscriptMessageUuid(item.id) === rewindEditTargetUuid
            }
            {...(item === liveLimitStopMessage && onSetAutoContinue
              ? { autoContinueEnabled, hasResetMessage, onSetAutoContinue }
              : {})}
          />
        );
      })}
    </>
  );
}
