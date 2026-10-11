import type { BackgroundTaskInfo } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';

import { describeOperation, parseToolInput } from './toolActivity';

export type BackgroundWorkState = 'running' | 'completed' | 'failed' | 'stopped' | 'ended';

/** One agent or background command, as the session's background-work list shows it. */
export type BackgroundWorkItem = {
  /** The call that launched it. */
  key: string;
  kind: 'agent' | 'command';
  /** The agent's type, or the command line. */
  title: string;
  description: string;
  /** `ended` when it still read running after its run closed, so how it ended is unknown. */
  state: BackgroundWorkState;
  /** What a stop or an output read is addressed by; absent until the provider names it. */
  taskId?: string;
  callCount: number;
  durationMs: number | null;
  message: ChatMessage;
  /** What launched it, when that was an agent rather than the main conversation. */
  launchedBy?: string;
  /** Known only from the provider's live task list, with no call in the chat to open. */
  liveOnly?: boolean;
};

/** The same test the agent's own row uses, so the count and the rows agree. */
export function isRunningAgent(message: ChatMessage): boolean {
  if (!message.isSubagentContainer) return false;
  const status = message.subagentState?.agentStatus;
  return status ? status.state === 'running' : describeOperation(message).status === 'running';
}

function agentState(message: ChatMessage): BackgroundWorkState {
  if (isRunningAgent(message)) return 'running';
  const status = message.subagentState?.agentStatus?.state;
  if (status === 'failed' || status === 'stopped') return status;
  const operation = describeOperation(message).status;
  return operation === 'error' || operation === 'denied' ? 'failed' : 'completed';
}

/** Every agent and background command in the loaded chat, oldest first. */
export function listBackgroundWork(messages: ChatMessage[], isLive: boolean): BackgroundWorkItem[] {
  const items: BackgroundWorkItem[] = [];
  for (const message of messages) {
    const input = parseToolInput(message.toolInput);
    const key = message.toolId || String(message.id);
    if (message.isSubagentContainer) {
      const status = message.subagentState?.agentStatus;
      const state = agentState(message);
      const operation = describeOperation(message);
      const launch = message.toolResult?.toolUseResult as { agentId?: unknown } | undefined;
      const taskId = status?.taskId ?? (typeof launch?.agentId === 'string' ? launch.agentId : undefined);
      items.push({
        key,
        kind: 'agent',
        title: String(input?.subagent_type || '').trim(),
        description: String(input?.description || '').trim(),
        state: state === 'running' && !isLive ? 'ended' : state,
        ...(taskId ? { taskId } : {}),
        callCount: Math.max(message.subagentState?.childTools.length ?? 0, status?.toolUses ?? 0),
        // A notice sent while the agent still had work of its own carries an interim duration.
        durationMs: status?.durationMs != null || operation.durationMs != null
          ? Math.max(status?.durationMs ?? 0, operation.durationMs ?? 0) : null,
        message,
      });
    } else if (message.backgroundState) {
      const taskId = (message.toolResult?.toolUseResult as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId;
      items.push({
        key,
        kind: 'command',
        title: String(input?.command || '').trim(),
        description: String(input?.description || '').trim(),
        state: message.backgroundState === 'running' && !isLive ? 'ended' : message.backgroundState,
        ...(typeof taskId === 'string' && taskId ? { taskId } : {}),
        callCount: 0,
        durationMs: null,
        message,
      });
    }
  }
  return items;
}

/** The whole session's work: stored items fill in what the loaded pages lack, and loaded ones win, being live. */
export function mergeBackgroundWork(loaded: BackgroundWorkItem[], stored: BackgroundWorkItem[]): BackgroundWorkItem[] {
  if (stored.length === 0) return loaded;
  const loadedKeys = new Set(loaded.map((item) => item.key));
  const time = (item: BackgroundWorkItem) => Date.parse(String(item.message.timestamp ?? '')) || 0;
  return [...loaded, ...stored.filter((item) => !loadedKeys.has(item.key))].sort((a, b) => time(a) - time(b));
}

/**
 * The provider's live task list is the truth for what runs: a listed item is running, and
 * a listed task with no item (one an agent launched) joins the list. Without one, the items stand.
 */
export function applyLiveTasks(items: BackgroundWorkItem[], liveTasks: BackgroundTaskInfo[] | undefined): BackgroundWorkItem[] {
  if (!liveTasks) return items;
  const live = new Set(liveTasks.map((task) => task.taskId));
  const byTask = new Map(items.flatMap((item) => (item.taskId ? [[item.taskId, item] as const] : [])));
  const labelOf = (taskId?: string) => {
    const parent = taskId ? byTask.get(taskId) ?? liveTasks.find((task) => task.taskId === taskId) : undefined;
    return parent ? parent.description || ('title' in parent ? parent.title : parent.agentType) || undefined : undefined;
  };
  const merged = items.map((item) => (item.taskId && live.has(item.taskId) && item.state !== 'running'
    ? { ...item, state: 'running' as const }
    : item));
  for (const task of liveTasks) {
    if (byTask.has(task.taskId)) continue;
    const launchedBy = labelOf(task.parentTaskId);
    merged.push({
      key: `task:${task.taskId}`,
      kind: task.kind,
      title: task.kind === 'agent' ? task.agentType ?? '' : task.description,
      description: task.kind === 'agent' ? task.description : '',
      state: 'running',
      taskId: task.taskId,
      callCount: 0,
      durationMs: null,
      message: { type: 'assistant', content: '', timestamp: '' },
      ...(launchedBy ? { launchedBy } : {}),
      liveOnly: true,
    });
  }
  return merged;
}
