import type { ChatMessage } from '../types/types';

import { isStandaloneTool } from './toolActivity';

export interface ToolActivityItem {
  _isGroup: true;
  /** Tool calls in order, with any shown thinking that fell between two of them. */
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
}

export type MessageListItem = ChatMessage | ToolActivityItem;

export interface GroupToolActivitiesOptions {
  showThinking?: boolean;
  /** Calls waiting on a permission prompt; each is its own row until answered. */
  pendingToolIds?: ReadonlySet<string>;
  /** Turn still running: a thought trailing an activity waits to learn whether it joins it. */
  holdTrailingThinking?: boolean;
}

export function isToolActivityItem(item: MessageListItem): item is ToolActivityItem {
  return '_isGroup' in item && (item as ToolActivityItem)._isGroup === true;
}

function isToolActivityCall(message: ChatMessage): boolean {
  return Boolean(message.isToolUse && message.toolName && !isStandaloneTool(message));
}

function isActivityMember(message: ChatMessage, pendingToolIds?: ReadonlySet<string>): boolean {
  return isToolActivityCall(message) && !(message.toolId && pendingToolIds?.has(message.toolId));
}

const activityCache = new WeakMap<ChatMessage, ToolActivityItem>();

function toActivity(members: ChatMessage[]): ToolActivityItem {
  const cached = activityCache.get(members[0]);
  const activity = cached && cached.messages.length === members.length
    && cached.messages.every((member, position) => member === members[position])
    ? cached : { _isGroup: true as const, messages: members, timestamp: members[0].timestamp };
  activityCache.set(members[0], activity);
  return activity;
}

/**
 * An activity is every tool call between two rendered non-tool rows. Thinking never ends one;
 * a different Codex `turnId` does.
 */
export function groupToolActivities(
  messages: ChatMessage[],
  { showThinking = true, pendingToolIds, holdTrailingThinking = false }: GroupToolActivitiesOptions = {},
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (!isActivityMember(message, pendingToolIds)) {
      // A call waiting on its prompt is a one-call activity of its own until answered.
      items.push(isToolActivityCall(message) ? toActivity([message]) : message);
      index += 1;
      continue;
    }

    const members: ChatMessage[] = [message];
    let lastCall = message;
    // Shown thinking joins only once a later call proves it sits inside the activity.
    let heldThinking: ChatMessage[] = [];
    let nextIndex = index + 1;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      if (candidate.isThinking) {
        if (showThinking) heldThinking.push(candidate);
        nextIndex += 1;
        continue;
      }

      if (
        !isActivityMember(candidate, pendingToolIds)
        || (lastCall.turnId && candidate.turnId && lastCall.turnId !== candidate.turnId)
      ) {
        break;
      }

      members.push(...heldThinking, candidate);
      heldThinking = [];
      lastCall = candidate;
      nextIndex += 1;
    }

    const undecided = holdTrailingThinking && nextIndex >= messages.length;
    items.push(toActivity(members), ...(undecided ? [] : heldThinking));
    index = nextIndex;
  }

  return items;
}

/**
 * An activity keeps the key any of its calls had last render, so calls joining
 * either end of a burst never remount the row (or close it). `previous` maps a
 * message key to its activity key; `byMessage` is the same map for this render.
 */
export function assignActivityKeys(
  items: readonly MessageListItem[],
  messageKey: (message: ChatMessage) => string,
  previous: ReadonlyMap<string, string>,
): { keys: Map<ToolActivityItem, string>; byMessage: Map<string, string> } {
  const keys = new Map<ToolActivityItem, string>();
  const byMessage = new Map<string, string>();
  const used = new Set<string>();
  for (const item of items) {
    if (!isToolActivityItem(item)) continue;
    const messageKeys = item.messages.map(messageKey);
    let key = messageKeys.map((k) => previous.get(k)).find((k) => k !== undefined && !used.has(k));
    if (!key) {
      const base = `tool-group-${messageKeys[0]}`;
      key = base;
      for (let n = 1; used.has(key); n += 1) key = `${base}__${n}`;
    }
    used.add(key);
    keys.set(item, key);
    for (const k of messageKeys) byMessage.set(k, key);
  }
  return { keys, byMessage };
}
