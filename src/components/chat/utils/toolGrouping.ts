import type { ChatMessage } from '../types/types';

import { isStandaloneTool } from './toolActivity';

export interface ToolActivityItem {
  _isGroup: true;
  /** Tool calls in order, with any shown thinking between, before or after them. */
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
}

export type MessageListItem = ChatMessage | ToolActivityItem;

export interface GroupToolActivitiesOptions {
  showThinking?: boolean;
  /** Calls waiting on a permission prompt; each is its own row until answered. */
  pendingToolIds?: ReadonlySet<string>;
  /** Turn still running: thinking at the end, outside an activity, waits to learn whether a call follows. */
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

const otherTurn = (a: ChatMessage, b: ChatMessage): boolean =>
  Boolean(a.turnId && b.turnId && a.turnId !== b.turnId);

/**
 * An activity is every tool call between two rendered non-tool rows, plus the thinking
 * either side of them. Thinking never ends one; a different Codex `turnId` does.
 */
export function groupToolActivities(
  messages: ChatMessage[],
  { showThinking = true, pendingToolIds, holdTrailingThinking = false }: GroupToolActivitiesOptions = {},
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    let openerIndex = index;
    while (openerIndex < messages.length && messages[openerIndex].isThinking) openerIndex += 1;
    const leading = messages.slice(index, openerIndex);
    const opener: ChatMessage | undefined = messages[openerIndex];

    if (!opener || !isActivityMember(opener, pendingToolIds)) {
      // Thinking no call follows stands alone; while live, a later call may still claim it.
      if (opener || !holdTrailingThinking) items.push(...leading);
      // A call waiting on its prompt is a one-call activity of its own until answered.
      if (opener) items.push(isToolActivityCall(opener) ? toActivity([opener]) : opener);
      index = openerIndex + 1;
      continue;
    }

    const members: ChatMessage[] = [...(showThinking ? leading : []), opener];
    let lastCall = opener;
    let nextIndex = openerIndex + 1;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];
      if (otherTurn(lastCall, candidate)) break;
      if (candidate.isThinking) {
        if (showThinking) members.push(candidate);
      } else if (isActivityMember(candidate, pendingToolIds)) {
        members.push(candidate);
        lastCall = candidate;
      } else {
        break;
      }
      nextIndex += 1;
    }

    items.push(toActivity(members));
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
