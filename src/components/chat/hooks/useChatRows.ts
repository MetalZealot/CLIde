import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import { getIntrinsicMessageKey } from '../utils/messageKeys';
import { assignActivityKeys, groupToolActivities, isToolActivityItem } from '../utils/toolGrouping';
import { computeTurnSummaries } from '../utils/turnDuration';

interface ChatRowsOptions {
  /** All loaded messages, so a turn whose prompt sits above the visible window still resolves. */
  chatMessages: ChatMessage[];
  isProcessing?: boolean;
  showThinking?: boolean;
  /** A call waiting on one of these stays its own row until it is answered. */
  pendingPermissionRequests?: PendingPermissionRequest[];
  turnStartedAt?: string | null;
  turnOutputTokens?: number | null;
}

/** How the chat turns messages into rows; the chat pane and the probe harness share it. */
export function useChatRows(
  visibleMessages: ChatMessage[],
  {
    chatMessages,
    isProcessing = false,
    showThinking = false,
    pendingPermissionRequests,
    turnStartedAt = null,
    turnOutputTokens = null,
  }: ChatRowsOptions,
) {
  const pendingToolIds = useMemo(
    () => new Set((pendingPermissionRequests ?? []).flatMap((request) => (request.toolId ? [request.toolId] : []))),
    [pendingPermissionRequests],
  );
  const items = useMemo(
    () => groupToolActivities(visibleMessages, {
      showThinking,
      pendingToolIds,
      holdTrailingThinking: isProcessing,
    }),
    [visibleMessages, showThinking, pendingToolIds, isProcessing],
  );
  const liveActivity = useMemo(() => {
    if (!isProcessing) return null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (isToolActivityItem(item)) return item;
    }
    return null;
  }, [items, isProcessing]);
  const turnSummaries = useMemo(
    () => computeTurnSummaries(chatMessages, isProcessing, turnStartedAt, turnOutputTokens),
    [chatMessages, isProcessing, turnStartedAt, turnOutputTokens],
  );
  const latestTurnReply = useMemo(() => {
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      if (turnSummaries.has(chatMessages[index])) return chatMessages[index];
    }
    return null;
  }, [chatMessages, turnSummaries]);

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
    for (const item of items) {
      if (isToolActivityItem(item)) {
        item.messages.forEach(assign);
      } else {
        assign(item);
      }
    }
    return keys;
  }, [items]);

  // Stable identity, so memoized rows skip re-rendering when only other rows changed.
  const messageKeyMapRef = useRef(messageKeyMap);
  messageKeyMapRef.current = messageKeyMap;
  const getMessageKey = useCallback(
    (message: ChatMessage) => messageKeyMapRef.current.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [],
  );

  const committedActivityKeysRef = useRef<ReadonlyMap<string, string>>(new Map());
  const activityKeys = useMemo(
    () => assignActivityKeys(items, getMessageKey, committedActivityKeysRef.current),
    [items, getMessageKey],
  );
  useLayoutEffect(() => {
    committedActivityKeysRef.current = activityKeys.byMessage;
  }, [activityKeys]);

  return { items, isProcessing, pendingToolIds, liveActivity, turnSummaries, latestTurnReply, getMessageKey, activityKeys };
}

export type ChatRowsModel = ReturnType<typeof useChatRows>;
