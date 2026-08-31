// Pure helpers exported by the chat hooks: composer popover routing, send-time
// model/effort selection, effort/model compatibility, and realtime
// permission-request de-duplication.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { PendingPermissionRequest } from '../types/types';

import {
  describeDropRejections,
  resolveComposerTabAction,
  resolveSessionSendSetting,
  resolveUsagePopoverView,
  selectPastedAttachments,
} from './useChatComposerState';
import { normalizedToChatMessages } from './useChatMessages';
import { reconcileEffortForAllowedValues } from './useChatProviderState';
import { appendStreamChunk, dedupePermissionRequestsById } from './useChatRealtimeHandlers';

// --- useChatComposerState ---------------------------------------------------

test('usage commands route to provider-specific popover detail', () => {
  assert.equal(resolveUsagePopoverView('usage', 'claude'), 'summary');
  assert.equal(resolveUsagePopoverView('usage', 'codex'), 'activity');
  assert.equal(resolveUsagePopoverView('cost', 'codex'), 'activity');
});

test('context commands expose only Claude breakdown detail', () => {
  assert.equal(resolveUsagePopoverView('context', 'claude'), 'breakdown');
  assert.equal(resolveUsagePopoverView('context', 'codex'), 'summary');
  assert.equal(resolveUsagePopoverView('status', 'claude'), null);
});

test('a queued send carries the session\'s own effort, never the provider seed', () => {
  // The snapshot buildSendOptions takes at queue time is dispatched verbatim,
  // so this is also what a message queued behind a running turn sends.
  assert.equal(resolveSessionSendSetting('medium', 'high', true), 'medium');
  assert.equal(resolveSessionSendSetting('opus', 'sonnet', true), 'opus');
});

test('an established session with no tracked value sends none, so the server resolves', () => {
  assert.equal(resolveSessionSendSetting(null, 'high', true), undefined);
  assert.equal(resolveSessionSendSetting(undefined, 'high', true), undefined);
});

test('only a chat with no id yet inherits the provider seed', () => {
  assert.equal(resolveSessionSendSetting(null, 'high', false), 'high');
  assert.equal(resolveSessionSendSetting(null, undefined, false), undefined);
});

test('composer Tab shortcuts keep permissions and collaboration distinct', () => {
  assert.equal(resolveComposerTabAction(false, false), 'permission');
  assert.equal(resolveComposerTabAction(false, true), 'permission');
  assert.equal(resolveComposerTabAction(true, true), 'collaboration');
  assert.equal(resolveComposerTabAction(true, false), null, 'reverse focus survives without collaboration modes');
});

const fileItem = (name: string) => ({ kind: 'file', getAsFile: () => ({ name } as File) });
const textItem = () => ({ kind: 'string', getAsFile: () => null });

test('a pasted PDF attaches, the same as dropping one', () => {
  const selected = selectPastedAttachments([fileItem('spec.pdf')], []);
  assert.deepEqual(selected.map((file) => file.name), ['spec.pdf']);
});

test('pasted text stays text and attaches nothing', () => {
  assert.deepEqual(selectPastedAttachments([textItem(), textItem()], []), []);
});

test('a file pasted alongside its text form still attaches', () => {
  const selected = selectPastedAttachments([textItem(), fileItem('notes.md')], []);
  assert.deepEqual(selected.map((file) => file.name), ['notes.md']);
});

test('the files fallback applies only when the platform reports no items', () => {
  const dropped = { name: 'photo.png' } as File;
  assert.deepEqual(selectPastedAttachments([], [dropped]), [dropped]);
  assert.deepEqual(selectPastedAttachments([textItem()], [dropped]), []);
});

test('an oversized drop is reported against the file that caused it', () => {
  assert.deepEqual(
    describeDropRejections([{ file: { name: 'huge.zip' }, errors: [{ code: 'file-too-large' }] }]),
    [{ fileName: 'huge.zip', reason: 'too-large' }],
  );
});

test('exceeding the count collapses to one message, not one per file', () => {
  const rejected = ['a.png', 'b.png', 'c.png'].map((name) => ({
    file: { name },
    errors: [{ code: 'too-many-files' }],
  }));
  assert.deepEqual(describeDropRejections(rejected), [{ reason: 'too-many', count: 3 }]);
});

test('an unnamed rejected file still produces a message', () => {
  assert.deepEqual(
    describeDropRejections([{ file: { name: '' }, errors: [{ code: 'file-invalid-type' }] }]),
    [{ fileName: 'Unknown file', reason: 'unreadable' }],
  );
});

// --- useChatProviderState ---------------------------------------------------

test('a model change drops an effort that model does not offer', () => {
  assert.equal(reconcileEffortForAllowedValues('xhigh', ['low', 'medium', 'high']), 'default');
});

test('an effort the new model still offers survives the change', () => {
  assert.equal(reconcileEffortForAllowedValues('medium', ['low', 'medium', 'high']), 'medium');
});

test('an explicit default stays the standing choice across a model change', () => {
  assert.equal(reconcileEffortForAllowedValues('default', ['low', 'high']), 'default');
});

test('a model offering no effort at all resolves to default rather than a guess', () => {
  assert.equal(reconcileEffortForAllowedValues('high', []), 'default');
  assert.equal(reconcileEffortForAllowedValues('', ['low', 'high']), 'default');
});

// --- useChatRealtimeHandlers ------------------------------------------------

const request = (
  requestId: unknown,
  overrides: Partial<PendingPermissionRequest> = {},
): PendingPermissionRequest => ({
  requestId,
  provider: 'claude',
  requestType: 'user_input',
  toolName: 'AskUserQuestion',
  sessionId: 'app-session-1',
  receivedAt: new Date().toISOString(),
  ...overrides,
} as PendingPermissionRequest);

test('the subscribe ack seats one panel per requestId', () => {
  // The server's pending lookup used to fan out across providers sharing one
  // interactive-request registry, answering a single pending question once per
  // runtime. The ack replaces the list wholesale, so both copies rendered.
  const deduped = dedupePermissionRequestsById([
    request('request-1'),
    request('request-1'),
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].requestId, 'request-1');
});

test('distinct pending requests all survive, in arrival order', () => {
  const deduped = dedupePermissionRequestsById([
    request('request-1'),
    request('request-2', { toolName: 'Bash' }),
    request('request-1'),
    request('request-3'),
  ]);

  assert.deepEqual(
    deduped.map((entry) => entry.requestId),
    ['request-1', 'request-2', 'request-3'],
  );
});

test('entries without a usable id are passed through rather than hidden', () => {
  // They are already broken for decision routing; dropping them would make that
  // harder to notice, not easier.
  const deduped = dedupePermissionRequestsById([
    request(undefined),
    request(''),
    request('request-1'),
  ]);

  assert.equal(deduped.length, 3);
});

test('an empty ack stays empty', () => {
  assert.deepEqual(dedupePermissionRequestsById([]), []);
});

test('two sessions streaming at once keep separate buffers', () => {
  const buffers = new Map<string, string>();
  appendStreamChunk(buffers, 'session-a', 'Hello ');
  appendStreamChunk(buffers, 'session-b', 'Other ');
  appendStreamChunk(buffers, 'session-a', 'world');
  assert.equal(appendStreamChunk(buffers, 'session-b', 'run'), 'Other run');
  assert.equal(buffers.get('session-a'), 'Hello world');
});

test('ending one session\'s stream leaves the other session mid-flight', () => {
  const buffers = new Map<string, string>();
  appendStreamChunk(buffers, 'session-a', 'partial');
  appendStreamChunk(buffers, 'session-b', 'done');
  buffers.delete('session-b');
  assert.equal(buffers.get('session-a'), 'partial');
});

// --- useChatMessages --------------------------------------------------------

const transcriptRow = (row: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: 'row',
  sessionId: 'session-a',
  timestamp: new Date().toISOString(),
  provider: 'claude',
  kind: 'text',
  ...row,
} as NormalizedMessage);

test('a tool result carrying no content renders instead of throwing', () => {
  // Claude normalization serializes a contentless tool_result block to
  // undefined, which reaches the formatter as a non-string.
  const messages = normalizedToChatMessages([
    transcriptRow({ id: 'tu1', kind: 'tool_use', toolId: 't1', toolName: 'Read' }),
    transcriptRow({ id: 'tr1', kind: 'tool_result', toolId: 't1', content: undefined }),
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].toolResult?.content, '');
});

test('an Agent tool call becomes a subagent container with its child tools', () => {
  const messages = normalizedToChatMessages([
    transcriptRow({
      id: 'tu1',
      kind: 'tool_use',
      toolId: 't1',
      toolName: 'Agent',
      toolInput: { description: 'Review the diff', subagent_type: 'code-reviewer' },
      subagentTools: [
        { toolId: 'c1', toolName: 'Grep', toolInput: { pattern: 'TODO' } },
      ],
    }),
    transcriptRow({ id: 'tr1', kind: 'tool_result', toolId: 't1', content: 'done' }),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isSubagentContainer, true);
  assert.deepEqual(
    messages[0].subagentState?.childTools.map((tool) => tool.toolName),
    ['Grep'],
  );
  assert.equal(messages[0].subagentState?.isComplete, true);
});

test('the former Task name still opens a subagent container', () => {
  const messages = normalizedToChatMessages([
    transcriptRow({ id: 'tu2', kind: 'tool_use', toolId: 't2', toolName: 'Task', toolInput: {} }),
  ]);
  assert.equal(messages[0].isSubagentContainer, true);
});

test('an ordinary tool call is not a subagent container', () => {
  const messages = normalizedToChatMessages([
    transcriptRow({ id: 'tu3', kind: 'tool_use', toolId: 't3', toolName: 'Read', toolInput: {} }),
  ]);
  assert.equal(messages[0].isSubagentContainer, false);
});
