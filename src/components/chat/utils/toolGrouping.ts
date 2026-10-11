import { isBrowserCall } from '../../browser-use/browserSteps';
import type { ChatMessage } from '../types/types';

import { isStandaloneTool } from './toolActivity';

export interface ToolActivityItem {
  _isGroup: true;
  /** Tool calls in order, with any shown thinking between, before or after them. */
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
  /** A run of browser calls, drawn as one browser card. */
  browser?: true;
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
  return isToolActivityCall(message) && !(message.toolId && pendingToolIds?.has(message.toolId)) && !message.backgroundState;
}

const activityCache = new WeakMap<ChatMessage, ToolActivityItem>();

function toActivity(members: ChatMessage[], browser = false): ToolActivityItem {
  const cached = activityCache.get(members[0]);
  const activity = cached && cached.messages.length === members.length && Boolean(cached.browser) === browser
    && cached.messages.every((member, position) => member === members[position])
    ? cached : { _isGroup: true as const, messages: members, timestamp: members[0].timestamp, ...(browser && { browser: true as const }) };
  activityCache.set(members[0], activity);
  return activity;
}

const otherTurn = (a: ChatMessage, b: ChatMessage): boolean =>
  Boolean(a.turnId && b.turnId && a.turnId !== b.turnId);

/**
 * An activity is every tool call between two rendered non-tool rows, plus the thinking
 * either side of them. Thinking never ends one; a different Codex `turnId` does, and so
 * does a switch between browser and other calls, so a browser run is its own card.
 * A turn's browser runs then fold into one card at its latest run.
 */
export function groupToolActivities(
  messages: ChatMessage[],
  options: GroupToolActivitiesOptions = {},
): MessageListItem[] {
  const items = groupRuns(messages, options);
  // Latest run's first call → every browser run's members in its turn, in order.
  const folded = new Map<ChatMessage, ChatMessage[]>();
  const absorbed = new Set<ChatMessage>();
  let turnRuns: ToolActivityItem[] = [];
  const closeTurn = () => {
    if (turnRuns.length > 1) {
      const all = turnRuns.flatMap((run) => run.messages);
      folded.set(turnRuns[turnRuns.length - 1].messages[0], all);
      for (const run of turnRuns.slice(0, -1)) for (const member of run.messages) absorbed.add(member);
    }
    turnRuns = [];
  };
  for (const item of items) {
    if (isToolActivityItem(item)) {
      if (!item.browser) continue;
      const previous = turnRuns[turnRuns.length - 1];
      if (previous && otherTurn(previous.messages[previous.messages.length - 1], item.messages[0])) closeTurn();
      turnRuns.push(item);
    } else if (item.type === 'user') {
      closeTurn();
    }
  }
  closeTurn();
  return folded.size ? groupRuns(messages.filter((message) => !absorbed.has(message)), options, folded) : items;
}

function groupRuns(
  messages: ChatMessage[],
  { showThinking = true, pendingToolIds, holdTrailingThinking = false }: GroupToolActivitiesOptions,
  folded?: ReadonlyMap<ChatMessage, ChatMessage[]>,
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
      // A call waiting on its prompt is a one-call activity of its own until answered; a
      // background command is one for good, so its running state never colours its neighbours.
      if (opener) items.push(isToolActivityCall(opener) ? toActivity([opener]) : opener);
      index = openerIndex + 1;
      continue;
    }

    const browser = isBrowserCall(opener);
    // A browser card lists actions only, so the thinking before it keeps its own row.
    if (browser && showThinking) items.push(...leading);
    const members: ChatMessage[] = [...(showThinking && !browser ? leading : []), opener];
    let lastCall = opener;
    let nextIndex = openerIndex + 1;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];
      if (otherTurn(lastCall, candidate)) break;
      if (candidate.isThinking) {
        if (showThinking) members.push(candidate);
      } else if (isActivityMember(candidate, pendingToolIds) && isBrowserCall(candidate) === browser) {
        members.push(candidate);
        lastCall = candidate;
      } else {
        break;
      }
      nextIndex += 1;
    }

    // Thinking after a browser run's last call belongs to whatever follows it.
    let end = members.length;
    if (browser) while (members[end - 1].isThinking) end -= 1;
    const run = members.slice(0, end);
    items.push(toActivity((browser && folded?.get(run[0])) || run, browser));
    index = nextIndex - (members.length - end);
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

// Mount cost of a history row in CLIde Browser on the Pi, fitted over the
// reference session (2026-09-24): text ~4 ms + 8.5 ms per 1,000 characters, a tool run ~1.5 ms.
const TEXT_ROW_MS = 4;
const TEXT_MS_PER_CHAR = 0.0085;
const TOOL_RUN_MS = 1.5;

/**
 * Oldest index to reveal above `start`: at most `maxMessages` messages whose
 * estimated mount cost fits `budgetMs`, and always at least one row.
 */
export function revealStartForBudget(
  messages: readonly ChatMessage[],
  start: number,
  maxMessages: number,
  budgetMs: number,
): number {
  const floor = Math.max(0, start - maxMessages);
  let spent = 0;
  let inRun = false;
  let index = start;
  while (index > floor) {
    const message = messages[index - 1];
    // Thinking beside calls folds into their activity; elsewhere it is its own row.
    const joinsRun: boolean = isToolActivityCall(message) || (inRun && Boolean(message.isThinking));
    if (!(joinsRun && inRun)) {
      const cost = joinsRun ? TOOL_RUN_MS : TEXT_ROW_MS + (message.content?.length ?? 0) * TEXT_MS_PER_CHAR;
      if (index < start && spent + cost > budgetMs) break;
      spent += cost;
    }
    inRun = joinsRun;
    index -= 1;
  }
  return index;
}
