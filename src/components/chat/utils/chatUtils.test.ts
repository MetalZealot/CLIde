// Chat utility helpers: message formatting and the new-session launcher.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';


import { type Project } from '../../../types/app';
import { buildRepositoryEntries } from '../../sidebar/utils/utils';
import { normalizedToChatMessages } from '../hooks/useChatMessages';
import type { ChatMessage } from '../types/types';

import { buildOperationDetail } from './operationDetail';
import { summarizeActivity } from './toolActivity';
import { assignActivityKeys, groupToolActivities, isToolActivityItem } from './toolGrouping';
import {
  extractInternalMemoryCitation,
  formatDuration,
  formatFollowUpQuestions,
  formatMemoryCitationSource,
  splitLeadingCommand,
} from './chatFormatting';
import { exportToHTML, exportToMarkdown } from './chatExport';
import {
  adjacentPromptTurn,
  chatFindEntriesForRecord,
  chatFindSegments,
  listPromptTurns,
  locateSearchTarget,
  markdownDisplayText,
  mergeFindRecords,
  searchChatFindEntries,
} from './chatFindIndex';
import { resolveLauncherCheckoutSelection, resolvePrimaryCheckout } from './newSessionLauncher';
import { computeTurnDurations } from './turnDuration';
import {
  collectPendingAsyncQuestions,
  enqueueAsyncAnswer,
  formatAsyncQuestionAnswer,
  markAsyncQuestionHandled,
  readHandledAsyncQuestions,
  readQueuedAsyncAnswers,
  removeQueuedAsyncAnswer,
  unmarkAsyncQuestionHandled,
} from './asyncQuestionState';

describe('chatFormatting', () => {
  const citation = `<oai-mem-citation>
  <citation_entries>
  MEMORY.md:48-69|note=[used provider guidance]
  </citation_entries>
  <rollout_ids>
  019fa084-2786-7a32-8a93-ff1b3f8efae0
  </rollout_ids>
  </oai-mem-citation>`;

  test('extracts a complete internal memory citation from the end of an assistant reply', () => {
    assert.deepEqual(
      extractInternalMemoryCitation(`The requested change is complete.\n\n${citation}\n`),
      {
        text: 'The requested change is complete.',
        citations: [{ source: 'MEMORY.md:48-69', note: 'used provider guidance' }],
      },
    );
  });

  test('extracts an internal-only memory citation without retaining the XML envelope', () => {
    assert.deepEqual(extractInternalMemoryCitation(citation), {
      text: '',
      citations: [{ source: 'MEMORY.md:48-69', note: 'used provider guidance' }],
    });
  });

  test('formats elapsed durations in seconds, minutes, and hours', () => {
    assert.equal(formatDuration(42_400), '42s');
    assert.equal(formatDuration(72_000), '1m 12s');
    assert.equal(formatDuration(4_380_000), '1h 13m');
  });

  test('labels only the last reply of each finished turn with prompt-to-reply time', () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 14, 12, 0, seconds)).toISOString();
    const prompt: ChatMessage = { type: 'user', content: 'Fix it', timestamp: at(0) };
    const firstReply: ChatMessage = { type: 'assistant', content: 'Looking.', timestamp: at(5) };
    const tool: ChatMessage = { type: 'assistant', content: '', isToolUse: true, toolName: 'Bash', timestamp: at(20) };
    const finalReply: ChatMessage = { type: 'assistant', content: 'Done.', timestamp: at(72) };
    const notice: ChatMessage = { type: 'assistant', content: 'Task finished', isTaskNotification: true, timestamp: at(3000) };
    const noticeReply: ChatMessage = { type: 'assistant', content: 'Noted.', timestamp: at(3004) };
    const secondPrompt: ChatMessage = { type: 'user', content: 'Next', timestamp: at(3100) };
    const runningReply: ChatMessage = { type: 'assistant', content: 'Working.', timestamp: at(3110) };
    const messages = [prompt, firstReply, tool, finalReply, notice, noticeReply, secondPrompt, runningReply];

    const running = computeTurnDurations(messages, true);
    assert.equal(running.get(finalReply), 72_000);
    assert.equal(running.get(firstReply), undefined, 'only the last reply of a turn is labelled');
    assert.equal(running.get(noticeReply), 4_000, 'a task notification starts its own turn');
    assert.equal(running.get(runningReply), undefined, 'a running turn has no duration');
    assert.equal(computeTurnDurations(messages, false).get(runningReply), 10_000);
    assert.equal(computeTurnDurations([firstReply, finalReply], false).get(finalReply), undefined,
      'a turn whose prompt is not loaded has no start');
    assert.equal(computeTurnDurations([tool, finalReply], false, at(2)).get(finalReply), 70_000,
      'the server-supplied prompt time covers a page that opens mid-turn');
  });

  test('formats a cited line range compactly for display', () => {
    assert.equal(formatMemoryCitationSource('MEMORY.md:48-69'), 'MEMORY.md:48–69');
  });

  test('formats non-blocking questions as readable copied text', () => {
    assert.equal(formatFollowUpQuestions([
      { question: 'Which environment?', options: ['Staging', 'Production'] },
      { question: 'Anything else?', options: [] },
    ]), 'Which environment?\n- Staging\n- Production\n\nAnything else?');
  });

  test('preserves reserved citation markup when it is not the final block', () => {
    const content = `${citation}\n\nThis paragraph follows the example.`;
    assert.deepEqual(extractInternalMemoryCitation(content), { text: content, citations: [] });
  });

  test('preserves incomplete or similarly named XML-like content', () => {
    const incomplete = 'Example:\n<oai-mem-citation><citation_entries>unfinished';
    const ordinary = '<memory-citation>keep this</memory-citation>';

    assert.deepEqual(extractInternalMemoryCitation(incomplete), { text: incomplete, citations: [] });
    assert.deepEqual(extractInternalMemoryCitation(ordinary), { text: ordinary, citations: [] });
  });

  test('assistant normalization exposes compact citations while user text remains untouched', () => {
    const messages = normalizedToChatMessages([
      {
        id: 'assistant-1',
        sessionId: 'session-1',
        timestamp: '2026-07-29T12:00:00.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'assistant',
        content: `Visible answer.\n\n${citation}`,
      },
      {
        id: 'user-1',
        sessionId: 'session-1',
        timestamp: '2026-07-29T12:01:00.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'user',
        content: citation,
      },
    ]);

    assert.equal(messages[0]?.content, 'Visible answer.');
    assert.deepEqual(messages[0]?.memoryCitations, [
      { source: 'MEMORY.md:48-69', note: 'used provider guidance' },
    ]);
    assert.equal(messages[1]?.content, citation);
    assert.equal(messages[1]?.memoryCitations, undefined);
  });

  test('tool rows keep when their result arrived and which turn issued them', () => {
    const tool = { sessionId: 's', provider: 'codex' as const, kind: 'tool_use' as const, toolName: 'Bash', toolInput: { command: 'ls' } };
    const running = { ...tool, id: 'live', toolId: 'live', timestamp: '2026-09-21T10:00:05.000Z', turnId: 'turn-1' };
    const result = { id: 'live:result', sessionId: 's', provider: 'codex' as const, kind: 'tool_result' as const, toolId: 'live', content: 'done', timestamp: '2026-09-21T10:00:35.000Z' };
    const [attached] = normalizedToChatMessages([{
      ...tool, id: 'paged', toolId: 'paged', timestamp: '2026-09-21T10:00:00.000Z',
      toolResult: { content: 'ok', isError: false, timestamp: '2026-09-21T10:00:04.000Z' },
    }]);
    assert.equal(attached?.toolResult?.timestamp, '2026-09-21T10:00:04.000Z');

    const [before] = normalizedToChatMessages([running]);
    const [after] = normalizedToChatMessages([running, result]);
    assert.equal(before?.toolResult, null);
    assert.equal(before?.turnId, 'turn-1');
    assert.notEqual(after, before, 'a finished tool is a new display object, never a mutated one');
    assert.equal(after?.toolResult?.timestamp, '2026-09-21T10:00:35.000Z');
  });

  test('assistant normalization preserves a question-only message', () => {
    const [message] = normalizedToChatMessages([{
      id: 'question-1',
      sessionId: 'session-1',
      timestamp: '2026-09-06T12:00:00.000Z',
      provider: 'codex',
      kind: 'text',
      role: 'assistant',
      content: '',
      followUpQuestions: [{ question: 'Which environment?', options: ['Staging'] }],
    }]);

    assert.equal(message?.content, '');
    assert.deepEqual(message?.followUpQuestions, [
      { question: 'Which environment?', options: ['Staging'] },
    ]);
  });
});

describe('async question state', () => {
  test('frames one answer as the ordinary user message Codex expects', () => {
    assert.equal(
      formatAsyncQuestionAnswer(' Which environment? ', ' Staging '),
      '> Which environment?\n\nStaging',
    );
  });

  test('keeps questions sequential and does not let a persisted answer echo consume the next one', () => {
    const messages: ChatMessage[] = [
      {
        id: 'ask-1',
        type: 'assistant',
        content: '',
        timestamp: '2026-09-07T12:00:00.000Z',
        followUpQuestions: [
          { question: 'First?', options: ['One'] },
          { question: 'Second?', options: ['Two'] },
        ],
      },
      {
        id: 'user-answer-1',
        type: 'user',
        content: '> First?\n\nOne',
        timestamp: '2026-09-07T12:01:00.000Z',
      },
    ];
    const pending = collectPendingAsyncQuestions(messages, [
      { id: 'ask-1:0', content: '> First?\n\nOne' },
    ]);

    assert.deepEqual(pending.map((question) => question.id), ['ask-1:1']);
  });

  test('does not mistake an unrelated composer message for an async-question answer', () => {
    const pending = collectPendingAsyncQuestions([
      {
        id: 'ask-1',
        type: 'assistant',
        content: '',
        timestamp: '2026-09-07T12:00:00.000Z',
        followUpQuestions: [{ question: 'Which environment?', options: ['Staging'] }],
      },
      {
        id: 'normal-user-turn',
        type: 'user',
        content: 'Please also update the tests.',
        timestamp: '2026-09-07T12:01:00.000Z',
      },
    ], []);

    assert.deepEqual(pending.map((question) => question.id), ['ask-1:0']);
  });

  test('persists handled state and a FIFO independently from the normal composer queue', () => {
    const sessionId = `async-state-${Date.now()}`;
    const content = '> Continue?\n\nYes';
    markAsyncQuestionHandled(sessionId, 'ask:0', content);
    enqueueAsyncAnswer(sessionId, {
      id: 'answer-1',
      questionId: 'ask:0',
      question: 'Continue?',
      answer: 'Yes',
      content,
      provider: 'codex',
      options: { model: 'gpt-6-astra' },
      queuedAt: '2026-09-07T12:00:00.000Z',
    });

    assert.deepEqual(readHandledAsyncQuestions(sessionId), [{ id: 'ask:0', content }]);
    assert.equal(readQueuedAsyncAnswers(sessionId)[0]?.content, content);
    assert.equal(removeQueuedAsyncAnswer(sessionId, 'answer-1')?.questionId, 'ask:0');
    assert.deepEqual(readQueuedAsyncAnswers(sessionId), []);
    unmarkAsyncQuestionHandled(sessionId, 'ask:0');
    assert.deepEqual(readHandledAsyncQuestions(sessionId), []);
  });
});

describe('splitLeadingCommand', () => {
  const names = new Set(['/compact', '/fork', '$review-diff']);

  test('splits a leading command from its argument and rebuilds the input exactly', () => {
    const match = splitLeadingCommand('/compact focus on the auth work', names);
    assert.deepEqual(match, { command: '/compact', separator: ' ', rest: 'focus on the auth work' });
    assert.equal(`${match!.command}${match!.separator}${match!.rest}`, '/compact focus on the auth work');
  });

  test('reports an empty argument so the hint can show, with or without a trailing space', () => {
    assert.deepEqual(splitLeadingCommand('/compact', names), { command: '/compact', separator: '', rest: '' });
    assert.deepEqual(splitLeadingCommand('/compact ', names), { command: '/compact', separator: ' ', rest: '' });
  });

  test('matches whole names only, at the start, for either provider prefix', () => {
    assert.equal(splitLeadingCommand('/compacted the notes', names), null);
    assert.equal(splitLeadingCommand('/unknown thing', names), null);
    assert.equal(splitLeadingCommand('please /compact this', names), null);
    assert.equal(splitLeadingCommand(' /compact', names), null);
    assert.equal(splitLeadingCommand('', names), null);
    assert.equal(splitLeadingCommand('$review-diff', names)?.command, '$review-diff');
  });

  test('keeps a newline in the argument so the overlay stays aligned with the textarea', () => {
    assert.deepEqual(splitLeadingCommand('/compact\nkeep the ADRs', names), {
      command: '/compact',
      separator: '',
      rest: '\nkeep the ADRs',
    });
  });
});

describe('chatExport', () => {
  const messages = [
    {
      type: 'user',
      content: 'Run the check.',
      timestamp: '2026-08-17T12:00:00.000Z',
    },
    {
      type: 'assistant',
      content: '',
      timestamp: '2026-08-17T12:00:01.000Z',
      isToolUse: true,
      toolName: 'Bash',
      toolInput: '{"command":"pwd"}',
      toolResult: { content: '<workspace>\n```nested```', isError: false },
      subagentState: {
        currentToolIndex: 0,
        isComplete: true,
        childTools: [{
          toolId: 'child-1',
          toolName: 'Read',
          toolInput: { path: '/tmp/example' },
          toolResult: { content: 'child result', isError: false },
          timestamp: new Date('2026-08-17T12:00:02.000Z'),
        }],
      },
    },
    {
      type: 'assistant',
      content: 'private reasoning',
      timestamp: '2026-08-17T12:00:03.000Z',
      isThinking: true,
    },
    {
      type: 'assistant',
      content: 'The check passed.',
      timestamp: '2026-08-17T12:00:04.000Z',
    },
  ];

  test('uses the owning provider label and excludes trace data by default', () => {
    const markdown = exportToMarkdown(messages, 'Codex session', {
      includeMeta: false,
      assistantLabel: 'Codex',
    });

    assert.match(markdown, /## Codex\n\nThe check passed\./);
    assert.doesNotMatch(markdown, /Claude|Bash|workspace|private reasoning/);
  });

  test('projects selected tool calls, results, child tools and reasoning into both formats', () => {
    const options = {
      includeMeta: false,
      assistantLabel: '<Codex>',
      includeToolCalls: true,
      includeToolResults: true,
      includeThinking: true,
    };
    const markdown = exportToMarkdown(messages, 'Codex session', options);
    const html = exportToHTML(messages, 'Codex session', options);

    for (const value of ['Bash', 'command', '<workspace>', 'Read', 'child result', 'private reasoning']) {
      assert.match(markdown, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(markdown, /````\n<workspace>\n```nested```\n````/);
    assert.match(html, /&lt;Codex&gt;/);
    assert.match(html, /&lt;workspace&gt;/);
    assert.match(html, /private reasoning/);
  });

  test('never emits tool results without their tool calls', () => {
    const markdown = exportToMarkdown(messages, undefined, {
      includeMeta: false,
      includeToolCalls: false,
      includeToolResults: true,
    });

    assert.doesNotMatch(markdown, /workspace|child result/);
  });
});

describe('newSessionLauncher', () => {
  const REPOSITORY_ID = '/workspace/example/.git';
  const mainCheckout: Project = {
    projectId: 'main-project',
    displayName: 'example',
    fullPath: '/workspace/example',
    repositoryId: REPOSITORY_ID,
    branch: 'master',
  };
  const worktree: Project = {
    projectId: 'feature-project',
    displayName: 'example-feature',
    fullPath: '/workspace/example-feature',
    repositoryId: REPOSITORY_ID,
    branch: 'feature/launcher',
  };

  test('primary checkout wins even when its branch is not literally main', () => {
    const [entry] = buildRepositoryEntries([worktree, mainCheckout]);

    assert.equal(resolvePrimaryCheckout(entry).projectId, 'main-project');
  });

  test('repositories without a registered main checkout retain the lead fallback', () => {
    const secondWorktree: Project = {
      ...worktree,
      projectId: 'second-feature',
      fullPath: '/workspace/example-second',
      branch: 'feature/second',
    };
    const [entry] = buildRepositoryEntries([worktree, secondWorktree]);

    assert.equal(resolvePrimaryCheckout(entry).projectId, 'feature-project');
  });

  test('registered worktrees remain valid session targets without adoption', async () => {
    let adoptionCalls = 0;
    const selected = await resolveLauncherCheckoutSelection(worktree, async () => {
      adoptionCalls += 1;
      return null;
    });

    assert.equal(selected, worktree);
    assert.equal(adoptionCalls, 0);
  });

  test('discovered worktrees are adopted before they become session targets', async () => {
    const discovered: Project = {
      ...worktree,
      projectId: 'discovered:/workspace/example-feature',
      isDiscovered: true,
    };
    const registered: Project = {
      ...worktree,
      projectId: 'registered-feature',
    };
    let adoptedPath = '';

    const selected = await resolveLauncherCheckoutSelection(discovered, async (checkoutPath) => {
      adoptedPath = checkoutPath;
      return registered;
    });

    assert.equal(adoptedPath, discovered.fullPath);
    assert.equal(selected, registered);
  });
});


test('tool activities reuse unchanged groups and update changed members or membership', () => {
  const first: ChatMessage = { id: 'tool-a', timestamp: '2026-09-19T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Bash' };
  const second: ChatMessage = { ...first, id: 'tool-b' };
  const text: ChatMessage = { id: 'plain', timestamp: '2026-09-19T00:00:01Z', type: 'assistant', content: 'Reply' };
  const initial = groupToolActivities([first, second]);
  const appended = groupToolActivities([first, second, text]);
  assert.equal(appended[0], initial[0]);
  const alone = groupToolActivities([first]);
  assert.ok(isToolActivityItem(alone[0]), 'one call is still an activity');
  assert.notEqual(alone[0], initial[0], 'a shrunk activity must release its removed members');
  const updated = groupToolActivities([first, { ...second, toolResult: { content: 'finished', isError: false } }, text]);
  assert.notEqual(updated[0], initial[0]);
  assert.ok(isToolActivityItem(updated[0]));
  assert.equal(updated[0].messages[1].toolResult?.content, 'finished');
});

test('an activity keeps its key while calls join it from above or below', () => {
  const call = (id: string): ChatMessage => ({ id, timestamp: '2026-09-23T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Bash' });
  const text: ChatMessage = { id: 'reply', timestamp: '2026-09-23T00:00:01Z', type: 'assistant', content: 'Reply' };
  const key = (message: ChatMessage) => String(message.id);
  const keyOf = (items: ReturnType<typeof groupToolActivities>, previous: ReadonlyMap<string, string>) => {
    const { keys, byMessage } = assignActivityKeys(items, key, previous);
    return { list: items.filter(isToolActivityItem).map((item) => keys.get(item)), byMessage };
  };

  const first = keyOf(groupToolActivities([call('c'), call('d')]), new Map());
  const prepended = keyOf(groupToolActivities([call('a'), call('b'), call('c'), call('d')]), first.byMessage);
  assert.deepEqual(prepended.list, first.list, 'older calls joining from above');
  const appended = keyOf(groupToolActivities([call('a'), call('b'), call('c'), call('d'), call('e')]), prepended.byMessage);
  assert.deepEqual(appended.list, first.list, 'newer calls joining from below');

  const split = keyOf(groupToolActivities([call('a'), call('b'), text, call('c'), call('d')]), appended.byMessage);
  assert.equal(split.list[0], first.list[0]);
  assert.equal(new Set(split.list).size, 2, 'a split burst gets a second, distinct key');
});

describe('tool activity boundaries', () => {
  const call = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id, timestamp: '2026-09-21T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Bash', ...extra,
  });
  const read = call('read', { toolName: 'Read' });
  const failed = call('failed', { toolResult: { content: 'exit 1', isError: true } });
  const thought: ChatMessage = { id: 'thought', timestamp: '2026-09-21T00:00:01Z', type: 'assistant', content: 'Checking', isThinking: true };
  const prose: ChatMessage = { id: 'prose', timestamp: '2026-09-21T00:00:02Z', type: 'assistant', content: 'Next.' };

  test('prose ends an activity; failures and thinking stay inside it', () => {
    const [activity, between, next] = groupToolActivities([read, thought, failed, prose, call('edit', { toolName: 'Edit' })]);
    assert.ok(isToolActivityItem(activity));
    assert.deepEqual(activity.messages, [read, thought, failed]);
    assert.equal(between, prose);
    assert.ok(isToolActivityItem(next));
    const [hidden] = groupToolActivities([read, thought, failed], { showThinking: false });
    assert.ok(isToolActivityItem(hidden));
    assert.deepEqual(hidden.messages, [read, failed]);
    assert.deepEqual(groupToolActivities([read, thought, prose]).slice(1), [thought, prose], 'trailing thinking belongs to what follows');
    assert.equal(groupToolActivities([read, thought], { holdTrailingThinking: true }).length, 1, 'a live trailing thought waits');
    assert.deepEqual(groupToolActivities([read, thought]).slice(1), [thought], 'a finished turn shows it');
  });

  test('questions, to-do lists, subagents, compaction, turns and pending permissions cut one', () => {
    const boundaries: ChatMessage[] = [
      call('question', { toolName: 'AskUserQuestion' }),
      call('input', { toolName: 'request_user_input' }),
      call('todo', { toolName: 'TodoWrite' }),
      call('plan', { toolName: 'ExitPlanMode' }),
      call('agent', { toolName: 'Agent', isSubagentContainer: true }),
      { id: 'compact', timestamp: '2026-09-21T00:00:03Z', type: 'assistant', content: '', isCompactBoundary: true },
      { id: 'prompt', timestamp: '2026-09-21T00:00:03Z', type: 'user', content: 'Go on' },
    ];
    for (const boundary of boundaries) {
      const items = groupToolActivities([read, boundary, failed]);
      assert.equal(items.length, 3, String(boundary.id));
      assert.equal(items[1], boundary);
    }
    assert.equal(groupToolActivities([call('turn-a', { turnId: 'a' }), call('turn-b', { turnId: 'b' })]).length, 2);
    assert.equal(groupToolActivities([call('turn-a', { turnId: 'a' }), call('child')]).length, 1, 'a missing turnId never cuts');
    const waiting = call('waiting', { toolId: 'call-7' });
    const cut = groupToolActivities([read, waiting, failed], { pendingToolIds: new Set(['call-7']) });
    assert.equal(cut.length, 3);
    assert.ok(isToolActivityItem(cut[1]) && cut[1].messages.length === 1 && cut[1].messages[0] === waiting,
      'the waiting call is a one-call activity of its own');
    assert.equal(groupToolActivities([read, waiting, failed]).length, 1, 'an answered call rejoins its activity');
  });

  test('a summary counts files, commands and line changes across provider shapes', () => {
    const done = { content: '', isError: false, timestamp: '2026-09-21T00:00:02Z' };
    const tool = (id: string, toolName: string, toolInput: unknown, extra: Partial<ChatMessage> = {}) =>
      call(id, { toolName, toolInput: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput), toolResult: done, ...extra });
    const codexPatch = 'const patch = "*** Begin Patch\\n*** Update File: /a/w.ts\\n@@\\n-x\\n+y\\n+z\\n*** End Patch";\ntools.apply_patch(patch);';
    const summary = summarizeActivity([
      tool('r1', 'Read', { file_path: '/a/x.ts' }),
      tool('r2', 'Read', { file_path: '/a/x.ts' }),
      thought,
      tool('r3', 'Read', { file_path: '/a/y.ts' }),
      tool('b1', 'Bash', { command: 'cat > f <<EOF\nline\nEOF', description: 'Write f' }),
      tool('e1', 'Edit', { file_path: '/a/x.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }),
      tool('e2', 'FileChanges', [{ path: '/a/z.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' }]),
      tool('e3', 'exec', codexPatch),
      tool('f1', 'Bash', { command: 'false' }, { toolResult: { content: 'exit 1', isError: true } }),
      tool('m1', 'mcp__cloudcli-browser__browser_click', {}),
      call('live', { toolName: 'Bash', toolInput: JSON.stringify({ command: 'npm test' }) }),
    ]);
    assert.deepEqual(summary.facets, [
      { kind: 'read', count: 2, added: 0, removed: 0 },
      { kind: 'bash', count: 3, added: 0, removed: 0 },
      { kind: 'edit', count: 3, added: 5, removed: 3 },
      { kind: 'other', count: 1, added: 0, removed: 0 },
    ]);
    assert.equal(summary.failed, 1);
    assert.equal(summary.operations[0].durationMs, 2000);
    assert.equal(summary.operations[3].description, 'Write f');
    assert.equal(summary.operations[6].target, 'w.ts');
    assert.equal(summary.operations[8].target, 'browser_click');
    assert.equal(summary.running?.target, 'npm test');
  });

  test('an opened call flattens to lines: command and output, changed lines only, files', () => {
    const done = (content: string, isError = false) => ({ content, isError, timestamp: '2026-09-21T00:00:02Z' });
    const bash = buildOperationDetail(call('b', { toolInput: JSON.stringify({ command: 'npm test', description: 'Run tests' }), toolResult: done('ok\n2 passed\n') }));
    assert.deepEqual(bash.blocks, [
      { type: 'lines', lines: [{ text: 'npm test', tone: 'command' }] },
      { type: 'lines', lines: [{ text: 'ok', tone: 'output' }, { text: '2 passed', tone: 'output' }] },
    ]);
    assert.equal(bash.copyText, 'npm test');

    const edit = buildOperationDetail(call('e', { toolName: 'Edit', toolInput: JSON.stringify({ file_path: '/a/x.ts', old_string: 'a\nb', new_string: 'a\nc' }), toolResult: done('') }));
    assert.deepEqual(edit.blocks, [{ type: 'lines', lines: [{ text: 'b', tone: 'removed' }, { text: 'c', tone: 'added' }] }]);

    const codex = buildOperationDetail(call('c', {
      toolName: 'FileChanges',
      toolInput: JSON.stringify([{ path: '/a/x.ts', diff: '@@ -1 +1 @@\n-old\n+new\n ctx\n@@ -9 +9 @@\n+more' }, { path: '/a/y.ts', diff: '+y' }]),
      toolResult: done('completed'),
    }));
    assert.deepEqual(codex.blocks[0], {
      type: 'lines',
      heading: 'x.ts',
      lines: [{ text: 'old', tone: 'removed' }, { text: 'new', tone: 'added' }, { text: '', tone: 'gap' }, { text: 'more', tone: 'added' }],
    });

    const search = buildOperationDetail(call('s', { toolName: 'Glob', toolInput: JSON.stringify({ pattern: '*.ts' }), toolResult: done('/a/x.ts\n/a/y.ts') }));
    assert.deepEqual(search.blocks, [{ type: 'files', paths: ['/a/x.ts', '/a/y.ts'] }]);

    const read = buildOperationDetail(call('r', { toolName: 'Read', toolInput: JSON.stringify({ file_path: '/a/x.ts' }), toolResult: done('1\tline') }));
    assert.equal(read.openPath, '/a/x.ts');

    const failed = buildOperationDetail(call('f', { toolInput: JSON.stringify({ command: 'false' }), toolResult: done('exit 1', true) }));
    assert.equal((failed.blocks[1] as { lines: Array<{ tone: string }> }).lines[0].tone, 'error');
    assert.deepEqual(buildOperationDetail(thought).blocks, [{ type: 'prose', text: 'Checking' }]);
  });
});

// --- chat find index --------------------------------------------------------

const findRecord = (id: string, content: string, role: 'user' | 'assistant' = 'assistant', extra: Record<string, unknown> = {}) => ({
  id, sessionId: 's', provider: 'claude' as const, kind: 'text' as const, role, content,
  timestamp: `2026-01-01T00:00:${id.replace(/\D/g, '').padStart(2, '0')}Z`, ...extra,
});

test('find text is the Markdown as displayed: no syntax, blocks kept apart', () => {
  assert.equal(markdownDisplayText('A **bold** [link](https://x.invalid) and `code`.'), 'A bold link and code.');
  assert.equal(markdownDisplayText('First.\n\nSecond.'), 'First.\nSecond.');
  assert.equal(markdownDisplayText('```ts\nconst a = 1;\n```'), 'ts\nconst a = 1;', 'the language label shows above code');
  assert.equal(markdownDisplayText('| Key | Value |\n| --- | --- |\n| row | 1 |'), 'Key\nValue\nrow\n1');
  assert.equal(markdownDisplayText('Use ```npm test``` here'), 'Use npm test here', 'inline fences render as code');
  assert.equal(markdownDisplayText('![alt text](x.png) <b>raw</b>'), ' <b>raw</b>', 'raw HTML shows as text; image alt does not');
});

test('find segments mirror what a message marks searchable', () => {
  const [assistant] = normalizedToChatMessages([findRecord('1', '{"a":1}')]);
  assert.deepEqual(chatFindSegments(assistant), ['{\n  "a": 1\n}'], 'JSON replies are shown pretty-printed');
  const questions = [{ question: 'Which one?', options: ['Left', 'Right'] }];
  const [asking] = normalizedToChatMessages([findRecord('2', formatFollowUpQuestions(questions), 'assistant', { followUpQuestions: questions })]);
  assert.deepEqual(chatFindSegments(asking), ['Which one?', 'Left', 'Right'], 'the duplicate fallback text is hidden');
  const [prompt] = normalizedToChatMessages([{ ...findRecord('3', 'Proceed?\n❯ 1. Yes\n  2. No'), kind: 'interactive_prompt' as const }]);
  assert.deepEqual(chatFindSegments(prompt), ['Proceed?', 'Yes', 'No']);
  const [tool] = normalizedToChatMessages([{ ...findRecord('4', ''), kind: 'tool_use' as const, toolName: 'Bash', toolId: 't', toolInput: { command: 'needle' } }]);
  assert.deepEqual(chatFindSegments(tool), [], 'tool activity is never searched');
  assert.deepEqual(chatFindEntriesForRecord({ ...findRecord('5', 'thinking needle'), kind: 'thinking' as const }), []);
});

test('find search is literal, case-insensitive and never joins segments', () => {
  const entries = [
    ...chatFindEntriesForRecord(findRecord('1', 'Price (a+b)? PRICE (A+B)?', 'user')),
    ...chatFindEntriesForRecord(findRecord('2', 'split', 'assistant', { followUpQuestions: [{ question: 'end', options: ['start'] }] })),
  ];
  assert.deepEqual(searchChatFindEntries(entries, 'price (a+b)?').map((match) => [match.messageId, match.ordinal]), [['1', 0], ['1', 1]]);
  assert.equal(searchChatFindEntries(entries, 'endstart').length, 0);
  assert.equal(searchChatFindEntries(entries, '').length, 0);
});

test('loaded rows lay over the whole-history text in conversation order', () => {
  const snapshot = [findRecord('1', 'a'), findRecord('2', 'b'), findRecord('3', 'c')];
  const edited = findRecord('2', 'b streamed');
  const tool = { ...findRecord('7', ''), kind: 'tool_use' as const, toolId: 't' };
  const ids = (records: Array<{ id: string; content?: string }>) => records.map((record) => record.content ?? record.id);
  assert.deepEqual(ids(mergeFindRecords(snapshot, [tool, edited, findRecord('8', 'new'), findRecord('3', 'c')])), ['a', 'b streamed', 'new', 'c']);
  assert.deepEqual(ids(mergeFindRecords(snapshot, [findRecord('3', 'c'), findRecord('9', 'live')])), ['a', 'b', 'c', 'live']);
  assert.deepEqual(ids(mergeFindRecords(snapshot, [findRecord('6', 'early'), findRecord('2', 'b')])), ['a', 'early', 'b', 'c']);
  assert.deepEqual(ids(mergeFindRecords(snapshot, [findRecord('9', 'first turn')])), ['a', 'b', 'c', 'first turn']);
  assert.deepEqual(ids(mergeFindRecords(null, [tool, findRecord('3', 'c')])), ['c']);
});

test('prompt navigation walks authored prompts from any message', () => {
  const entries = ['1', '2', '3', '4'].flatMap((id, index) => chatFindEntriesForRecord(findRecord(id, `turn ${id}`, index % 2 ? 'assistant' : 'user')));
  assert.deepEqual(listPromptTurns(entries).map((entry) => entry.messageId), ['1', '3']);
  assert.equal(adjacentPromptTurn(entries, null, -1)?.messageId, '3');
  assert.equal(adjacentPromptTurn(entries, null, 1)?.messageId, '1');
  assert.equal(adjacentPromptTurn(entries, '4', -1)?.messageId, '3');
  assert.equal(adjacentPromptTurn(entries, '2', 1)?.messageId, '3');
  assert.equal(adjacentPromptTurn(entries, '3', 1), null);
  assert.equal(adjacentPromptTurn(entries, 'missing', 1), null);
});

test('a sidebar result finds its record by snippet, else by nearest time', () => {
  const records = [findRecord('1', 'The deploy\nfailed twice today'), findRecord('30', 'later reply')];
  assert.equal(locateSearchTarget(records, { snippet: '...the deploy failed twice...' })?.id, '1');
  assert.equal(locateSearchTarget(records, { snippet: 'no such words anywhere', timestamp: '2026-01-01T00:00:28Z' })?.id, '30');
  assert.equal(locateSearchTarget(records, {}), null);
});
