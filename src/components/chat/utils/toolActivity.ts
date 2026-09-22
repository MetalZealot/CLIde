import type { ChatMessage } from '../types/types';
import type { ToolStatus } from '../tools/components/ToolStatusBadge';
import { isSubagentTool } from '../tools/subagentTools';
import { deriveToolStatus } from '../tools/toolStatus';

import { calculateDiff } from './messageTransforms';

export type FacetKind = 'read' | 'search' | 'web' | 'bash' | 'poll' | 'edit' | 'other';
/** `fetch` counts under the `web` facet; it only changes the one-call wording. */
export type OperationKind = FacetKind | 'fetch';

export interface ActivityOperation {
  message: ChatMessage;
  kind: OperationKind;
  /** File name, pattern, command, query or tool name; empty when the input names none. */
  target: string;
  /** Claude's own label for a Bash call. */
  description?: string;
  /** Files a read or edit touches, for distinct-file counts. */
  paths: string[];
  added: number;
  removed: number;
  status: ToolStatus;
  durationMs: number | null;
}

export interface ActivityFacet {
  kind: FacetKind;
  count: number;
  added: number;
  removed: number;
}

export interface ActivitySummary {
  operations: ActivityOperation[];
  /** In order of first appearance. */
  facets: ActivityFacet[];
  /** Errors and denials. */
  failed: number;
  /** The latest call still waiting for its result. */
  running: ActivityOperation | null;
}

// Own rows that end an activity: they ask for input or carry state the user tracks.
const STANDALONE_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'request_user_input',
  'ExitPlanMode',
  'exit_plan_mode',
  'TodoWrite',
  'TodoRead',
  'TodoList',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
]);

export function isStandaloneTool(message: ChatMessage): boolean {
  return Boolean(message.isSubagentContainer)
    || isSubagentTool(message.toolName)
    || STANDALONE_TOOL_NAMES.has(String(message.toolName || ''));
}

export function parseToolInput(toolInput: unknown): any {
  if (typeof toolInput !== 'string') return toolInput ?? {};
  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

export const basename = (path: string): string => path.split('/').filter(Boolean).pop() || path;

const firstLine = (text: unknown): string =>
  String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) || '';

function countUnifiedDiff(diff: unknown): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of String(diff ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

function countContentLines(content: unknown): number {
  const text = String(content ?? '');
  return text ? text.replace(/\n$/, '').split('\n').length : 0;
}

/** Codex live rows carry `[{ path, diff }]`; its rollout keys `{ [path]: { unified_diff } }`. */
function describeFileChanges(input: any): Pick<ActivityOperation, 'paths' | 'added' | 'removed'> {
  const entries: Array<{ path: string; diff: unknown }> = Array.isArray(input)
    ? input.map((change: any) => ({ path: String(change?.path || ''), diff: change?.diff }))
    : input && typeof input === 'object'
      ? Object.entries(input).map(([path, change]: [string, any]) => ({ path, diff: change?.unified_diff ?? change?.diff }))
      : [];
  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    const counts = countUnifiedDiff(entry.diff);
    added += counts.added;
    removed += counts.removed;
  }
  return { paths: entries.map((entry) => entry.path).filter(Boolean), added, removed };
}

export function readApplyPatchText(source: string): string {
  const quoted = /"(\*\*\* Begin Patch(?:[^"\\]|\\.)*)"/.exec(source);
  if (quoted) {
    try {
      return JSON.parse(`"${quoted[1]}"`);
    } catch {
      // Not JSON-compatible escaping; fall through to the raw text.
    }
  }
  const templated = /`(\*\*\* Begin Patch[\s\S]*?)`/.exec(source);
  if (templated) return templated[1];
  const start = source.indexOf('*** Begin Patch');
  return start >= 0 ? source.slice(start) : '';
}

function describeApplyPatch(source: string): Pick<ActivityOperation, 'paths' | 'added' | 'removed'> {
  const paths: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of readApplyPatchText(source).split('\n')) {
    const file = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (file) paths.push(file[1].trim());
    else if (line.startsWith('***')) continue;
    else if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { paths, added, removed };
}

const matchString = (source: string, key: string): string =>
  new RegExp(`[{,\\s]"?${key}"?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(source)?.[1] || '';

type Described = Omit<ActivityOperation, 'message' | 'status' | 'durationMs'>;

const described = (kind: OperationKind, target: string, extra: Partial<Described> = {}): Described => ({
  kind,
  target,
  paths: [],
  added: 0,
  removed: 0,
  ...extra,
});

/** Codex history keeps a call's nested tools as source text inside one `exec` row. */
function describeCodexExec(source: string): Described {
  if (/\btools\.apply_patch\s*\(/.test(source)) {
    const patch = describeApplyPatch(source);
    return described('edit', patch.paths.length === 1 ? basename(patch.paths[0]) : '', patch);
  }
  if (/\btools\.write_stdin\s*\(/.test(source)) return described('poll', '');
  if (/\btools\.view_image\s*\(/.test(source)) {
    const path = matchString(source, 'path');
    return described('read', basename(path), { paths: path ? [path] : [] });
  }
  if (/\btools\.web__run\s*\(/.test(source)) {
    const query = matchString(source, 'q');
    if (query) return described('web', query);
    const url = matchString(source, 'ref_id');
    return url.startsWith('http') ? described('fetch', url) : described('web', '');
  }
  return described('other', 'exec');
}

function describeInput(toolName: string, input: any): Described {
  switch (toolName) {
    case 'Read':
      return described('read', basename(String(input?.file_path || '')), { paths: input?.file_path ? [input.file_path] : [] });
    case 'Grep':
    case 'Glob':
      return described('search', String(input?.pattern || ''));
    case 'WebSearch':
      return described('web', String(input?.query || ''));
    case 'WebFetch':
      return described('fetch', String(input?.url || ''));
    case 'Bash':
      return described('bash', firstLine(input?.command), {
        description: typeof input?.description === 'string' && input.description.trim() ? input.description.trim() : undefined,
      });
    case 'Edit':
    case 'ApplyPatch': {
      let added = 0;
      let removed = 0;
      for (const line of calculateDiff(String(input?.old_string ?? ''), String(input?.new_string ?? ''))) {
        if (line.type === 'added') added += 1;
        else removed += 1;
      }
      const path = String(input?.file_path || '');
      return described('edit', basename(path), { paths: path ? [path] : [], added, removed });
    }
    case 'Write': {
      const path = String(input?.file_path || '');
      return described('edit', basename(path), { paths: path ? [path] : [], added: countContentLines(input?.content) });
    }
    case 'FileChanges': {
      const changes = describeFileChanges(input);
      return described('edit', changes.paths.length === 1 ? basename(changes.paths[0]) : '', changes);
    }
    case 'exec':
      return describeCodexExec(typeof input === 'string' ? input : JSON.stringify(input ?? ''));
    default: {
      const mcp = /^mcp__.+?__(.+)$/.exec(toolName);
      return described('other', mcp ? mcp[1] : toolName);
    }
  }
}

function readTime(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
}

const operationCache = new WeakMap<ChatMessage, ActivityOperation>();

export function describeOperation(message: ChatMessage): ActivityOperation {
  const cached = operationCache.get(message);
  if (cached) return cached;
  const toolName = String(message.toolName || '');
  const toolResult = message.toolResult;
  const durationMs = toolResult?.timestamp !== undefined
    ? readTime(toolResult.timestamp) - readTime(message.timestamp)
    : NaN;
  const operation: ActivityOperation = {
    ...describeInput(toolName, parseToolInput(message.toolInput)),
    message,
    status: deriveToolStatus(toolResult),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
  };
  operationCache.set(message, operation);
  return operation;
}

export function summarizeActivity(messages: ChatMessage[]): ActivitySummary {
  const operations = messages.filter((message) => message.isToolUse).map(describeOperation);
  const facets = new Map<FacetKind, ActivityFacet & { paths: Set<string>; unnamed: number }>();
  let failed = 0;
  let running: ActivityOperation | null = null;

  for (const operation of operations) {
    const kind: FacetKind = operation.kind === 'fetch' ? 'web' : operation.kind;
    let facet = facets.get(kind);
    if (!facet) {
      facet = { kind, count: 0, added: 0, removed: 0, paths: new Set(), unnamed: 0 };
      facets.set(kind, facet);
    }
    facet.added += operation.added;
    facet.removed += operation.removed;
    // Reads and edits count distinct files; everything else counts calls.
    if ((kind === 'read' || kind === 'edit') && operation.paths.length > 0) {
      operation.paths.forEach((path) => facet.paths.add(path));
    } else {
      facet.unnamed += 1;
    }
    if (operation.status === 'error' || operation.status === 'denied') failed += 1;
    if (operation.status === 'running') running = operation;
  }

  return {
    operations,
    facets: [...facets.values()].map(({ kind, added, removed, paths, unnamed }) => ({
      kind,
      count: paths.size + unnamed,
      added,
      removed,
    })),
    failed,
    running,
  };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const formatLineCounts = (added: number, removed: number): string => `+${added} −${removed}`;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const formatCounts = (added: number, removed: number): string => (added || removed ? ` ${formatLineCounts(added, removed)}` : '');

/** The call itself, past tense and without line counts: `Edited toolGrouping.ts`. */
export function operationLabel(operation: ActivityOperation, t: Translate, preferDescription = false): string {
  if (preferDescription && operation.kind === 'bash' && operation.description) return operation.description;
  return operation.target
    ? t(`activity.done.${operation.kind}`, { target: operation.target })
    : capitalize(t(`activity.facet.${operation.kind === 'fetch' ? 'web' : operation.kind}`, { count: Math.max(operation.paths.length, 1) }));
}

export function describeActivity(summary: ActivitySummary, t: Translate, isLive: boolean): { label: string; isRunning: boolean } {
  const running = isLive ? summary.running : null;
  if (running) {
    if (running.kind === 'bash' && running.description) return { label: running.description, isRunning: true };
    return {
      label: running.target
        ? t(`activity.running.${running.kind}`, { target: running.target })
        : t(`activity.runningAny.${running.kind}`),
      isRunning: true,
    };
  }

  if (summary.operations.length === 1) {
    const [only] = summary.operations;
    const counts = only.kind === 'edit' ? formatCounts(only.added, only.removed) : '';
    return { label: `${operationLabel(only, t)}${counts}`, isRunning: false };
  }

  const facets = summary.facets.map((facet) => {
    const text = t(`activity.facet.${facet.kind}`, { count: facet.count });
    return facet.kind === 'edit' ? `${text}${formatCounts(facet.added, facet.removed)}` : text;
  });
  return { label: capitalize(facets.join(', ')), isRunning: false };
}
