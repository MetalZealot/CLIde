// Chat utility helpers: message formatting and the new-session launcher.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';


import { type Project } from '../../../types/app';
import { buildRepositoryEntries } from '../../sidebar/utils/utils';
import { normalizedToChatMessages } from '../hooks/useChatMessages';
import { findFinishedPlans, isSamePlan, readPlanSignals } from '../hooks/useSessionPlan';
import { applyLiveTasks, listBackgroundWork, mergeBackgroundWork } from './backgroundWork';
import type { ChatMessage } from '../types/types';

import { buildOperationDetail } from './operationDetail';
import chatStrings from '../../../i18n/locales/en/chat.json';
import { describeActivity, describeOperation, summarizeActivity } from './toolActivity';
import { browserToolOf, describeBrowserStep, isBrowserCall, lastBrowserUrl } from '../../browser-use/browserSteps';
import { assignActivityKeys, groupToolActivities, isToolActivityItem, revealStartForBudget } from './toolGrouping';
import {
  extractInternalMemoryCitation,
  formatDuration,
  formatFollowUpQuestions,
  formatMemoryCitationSource,
  splitLeadingCommand,
  splitMarkdownBlocks,
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
import { computeTurnSummaries } from './turnDuration';
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

  test('labels only the last reply of each finished turn with every reply, its time and output tokens', () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 14, 12, 0, seconds)).toISOString();
    const prompt: ChatMessage = { type: 'user', content: 'Fix it', timestamp: at(0) };
    const firstReply: ChatMessage = { type: 'assistant', content: 'Looking.', timestamp: at(5), outputTokens: 40 };
    const tool: ChatMessage = { type: 'assistant', content: 'ls', isToolUse: true, toolName: 'Bash', timestamp: at(20), outputTokens: 300 };
    const thinking: ChatMessage = { type: 'assistant', content: 'Hmm.', isThinking: true, timestamp: at(30) };
    const finalReply: ChatMessage = { type: 'assistant', content: 'Done.', timestamp: at(72), outputTokens: 900 };
    const notice: ChatMessage = { type: 'assistant', content: 'Task finished', isTaskNotification: true, timestamp: at(3000) };
    const noticeReply: ChatMessage = { type: 'assistant', content: 'Noted.', timestamp: at(3004) };
    const secondPrompt: ChatMessage = { type: 'user', content: 'Next', timestamp: at(3100) };
    const runningReply: ChatMessage = { type: 'assistant', content: 'Working.', timestamp: at(3110), outputTokens: 5 };
    const messages = [prompt, firstReply, tool, thinking, finalReply, notice, noticeReply, secondPrompt, runningReply];

    const running = computeTurnSummaries(messages, true);
    assert.deepEqual(running.get(finalReply), { replyText: 'Looking.\n\nDone.', spokenText: 'Done.', durationMs: 72_000, outputTokens: 1_240 },
      'the copy joins the turn\'s replies and skips its tools and thinking; speech reads the last');
    assert.equal(running.get(firstReply), undefined, 'only the last reply of a turn is labelled');
    assert.deepEqual(running.get(noticeReply), { replyText: 'Noted.', spokenText: 'Noted.', durationMs: 4_000 }, 'a task notification starts its own turn');
    assert.equal(running.get(runningReply), undefined, 'a running turn has no summary');
    assert.deepEqual(computeTurnSummaries(messages, false).get(runningReply), { replyText: 'Working.', spokenText: 'Working.', durationMs: 10_000, outputTokens: 5 });
    assert.deepEqual(computeTurnSummaries([firstReply, finalReply], false).get(finalReply), { replyText: 'Looking.\n\nDone.', spokenText: 'Done.' },
      'a turn whose prompt is not loaded keeps its footer but has no start');
    assert.equal(computeTurnSummaries([prompt, tool], false).get(tool), undefined, 'a turn without a reply has no footer');
    assert.deepEqual(computeTurnSummaries([tool, finalReply], false, at(2)).get(finalReply), { replyText: 'Done.', spokenText: 'Done.', durationMs: 70_000 },
      'a page that opens mid-turn keeps its time but not a partial token count');
    assert.deepEqual(computeTurnSummaries([tool, finalReply], false, at(2), 40).get(finalReply), { replyText: 'Done.', spokenText: 'Done.', durationMs: 70_000, outputTokens: 1_240 },
      'tokens from above the page complete the count');
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

test('browser runs in one turn fold into one card at the latest, named by every provider, and read as steps', () => {
  const at = '2026-10-10T00:00:00Z';
  const call = (id: string, toolName: string, toolInput: unknown = {}): ChatMessage => (
    { id, timestamp: at, type: 'assistant', content: '', isToolUse: true, toolName, toolInput: JSON.stringify(toolInput) });
  const thought = (id: string): ChatMessage => ({ id, timestamp: at, type: 'assistant', content: 'hm', isThinking: true });
  const items = groupToolActivities([
    call('r', 'Read'),
    thought('t1'),
    call('b1', 'mcp__cloudcli-browser__browser_navigate', { url: 'http://localhost:5174/settings' }),
    thought('t2'),
    call('b2', 'browser_click', { element: 'Appearance' }),
    call('b3', 'cloudcli-browser_browser_type', { element: 'Search', text: 'secret' }),
    thought('t3'),
    call('e', 'Edit'),
    { id: 'say', timestamp: at, type: 'assistant', content: 'Checking the page' },
    call('b4', 'browser_take_screenshot'),
    { id: 'ask', timestamp: at, type: 'user', content: 'Again' },
    call('b5', 'browser_snapshot'),
  ]);
  const shape = items.map((item) => (isToolActivityItem(item)
    ? `${item.browser ? 'browser' : 'tools'}:${item.messages.map((m) => m.id).join(',')}` : item.id));
  assert.deepEqual(shape, ['tools:r,t1,t3,e', 'say', 'browser:b1,t2,b2,b3,b4', 'ask', 'browser:b5']);
  assert.equal(browserToolOf('mcp__other__browser_click'), null);
  const run = items[2];
  assert.ok(isToolActivityItem(run));
  const steps = run.messages.filter(isBrowserCall).map(describeBrowserStep);
  assert.deepEqual(steps, ['Opened localhost:5174/settings', 'Clicked “Appearance”', 'Typed into “Search”', 'Took a screenshot']);
  assert.equal(lastBrowserUrl(run.messages), 'localhost:5174/settings');
});

test('older rows are revealed within a mount-cost budget, a tool run counting once', () => {
  const call = (id: string): ChatMessage => ({ id, timestamp: '2026-09-24T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Bash' });
  const text = (id: string, length: number): ChatMessage => ({ id, timestamp: '2026-09-24T00:00:00Z', type: 'assistant', content: 'x'.repeat(length) });
  const shortRows = Array.from({ length: 10 }, (_, index) => text(`t${index}`, 0));
  assert.equal(revealStartForBudget(shortRows, 10, 20, 20), 5, 'five 4 ms rows fit 20 ms');
  assert.equal(revealStartForBudget(shortRows, 10, 3, 20), 7, 'the message cap still applies');
  const burst = [text('a', 0), ...Array.from({ length: 30 }, (_, index) => call(`c${index}`)), text('b', 0)];
  assert.equal(revealStartForBudget(burst, burst.length, 100, 10), 0, 'thirty calls cost one run');
  const thought = (id: string): ChatMessage => ({ ...text(id, 5_000), isThinking: true });
  const thinkingRun = [text('c', 0), call('d'), thought('e'), call('f')];
  assert.equal(revealStartForBudget(thinkingRun, 4, 20, 6), 0, 'thinking between calls joins their run');
  const long = [text('small', 0), text('huge', 10_000)];
  assert.equal(revealStartForBudget(long, 2, 20, 20), 1, 'one row always reveals, even over budget');
  assert.equal(revealStartForBudget(long, 0, 20, 20), 0);
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
  });

  test('thinking either side of an activity joins it; thinking with no call stays a row', () => {
    const [trailing, after] = groupToolActivities([read, thought, prose]);
    assert.ok(isToolActivityItem(trailing));
    assert.deepEqual(trailing.messages, [read, thought]);
    assert.equal(after, prose);
    const [leading] = groupToolActivities([prose, thought, read]).slice(1);
    assert.ok(isToolActivityItem(leading));
    assert.deepEqual(leading.messages, [thought, read]);
    assert.deepEqual(groupToolActivities([thought, prose]), [thought, prose]);
    assert.deepEqual(groupToolActivities([prose, thought], { holdTrailingThinking: true }), [prose], 'a live thought waits for a call');
    assert.deepEqual(groupToolActivities([prose, thought]), [prose, thought], 'a finished turn shows it');
    const [hidden] = groupToolActivities([prose, thought, read], { showThinking: false }).slice(1);
    assert.ok(isToolActivityItem(hidden));
    assert.deepEqual(hidden.messages, [read]);
  });

  test('questions, plans to approve, subagents, compaction, turns and pending permissions cut one', () => {
    const boundaries: ChatMessage[] = [
      call('question', { toolName: 'AskUserQuestion' }),
      call('input', { toolName: 'request_user_input' }),
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

  test('checklist calls join an activity, and its label names the steps they finished', () => {
    // Resolves the real English strings, so the assertions read as the user sees them.
    const t = (key: string, options: Record<string, unknown> = {}) => {
      let node: any = chatStrings;
      const parts = key.split('.');
      const leaf = parts.pop() as string;
      for (const part of parts) node = node[part];
      const template = String(node[leaf] ?? node[`${leaf}_${options.count === 1 ? 'one' : 'other'}`]);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]));
    };
    const done = { content: '', isError: false };
    const tool = (id: string, toolName: string, input: unknown) => call(id, { toolName, toolInput: JSON.stringify(input), toolResult: done });
    const start = tool('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' });
    const finish = tool('u2', 'TaskUpdate', { taskId: '1', status: 'completed' });
    const commands = [tool('b1', 'Bash', { command: 'npm test' }), tool('b2', 'Bash', { command: 'git status' })];
    for (const toolName of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'TodoList']) {
      assert.equal(groupToolActivities([read, call(toolName, { toolName }), failed]).length, 1, toolName);
    }

    const [activity] = groupToolActivities([start, ...commands, finish]);
    assert.ok(isToolActivityItem(activity));
    const summary = summarizeActivity(activity.messages);
    assert.deepEqual(summary.facets.map((facet) => facet.kind), ['bash'], 'plan calls are not counted as tools');
    assert.equal(describeActivity(summary, t, false).label, 'Ran 2 commands · step 1 done');
    assert.equal(describeActivity(summarizeActivity([start, commands[0]]), t, false).label, 'Ran npm test');
    const planned = ['Tab completes', 'Escape closes'].map((subject, index) => tool(`c${index}`, 'TaskCreate', { subject }));
    assert.equal(describeActivity(summarizeActivity(planned), t, false).label, 'Planned 2 steps');
    assert.equal(describeActivity(summarizeActivity([start]), t, false).label, 'Updated the plan');
    assert.equal(describeOperation(finish).planAction, 'done');
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

    const bashEditDiff = {
      files: [{ filePath: '/a/x.ts', hunks: [{ lines: [' ctx', '-old', '+new'] }, { lines: ['+more'] }] }],
      changedFiles: ['/a/x.ts', '/a/y.md'],
      moreFiles: 2,
    };
    const sed = call('d', {
      toolInput: JSON.stringify({ command: "sed -i 's/old/new/' x.ts" }),
      toolResult: { ...done('done'), toolUseResult: { stdout: '', bashEditDiff } },
    });
    assert.deepEqual(buildOperationDetail(sed).blocks, [
      { type: 'lines', lines: [{ text: "sed -i 's/old/new/' x.ts", tone: 'command' }] },
      {
        type: 'lines',
        heading: 'x.ts  +2 −1',
        lines: [{ text: 'old', tone: 'removed' }, { text: 'new', tone: 'added' }, { text: '', tone: 'gap' }, { text: 'more', tone: 'added' }],
      },
      { type: 'lines', lines: [{ text: 'Also changed, not diffed: y.md and 1 more.', tone: 'output' }] },
      { type: 'lines', lines: [{ text: 'done', tone: 'output' }] },
    ]);
    assert.deepEqual([describeOperation(sed).added, describeOperation(sed).removed], [2, 1]);

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

test('streaming markdown splits only where a block is finished, and pieces only ever append', () => {
  const reply = [
    'Intro paragraph.', '',
    '```ts', 'const a = 1;', '', 'const b = 2;', '```', '',
    '1. First', '', '2. Second', '   continued', '',
    '    indented code', '',
    '$$', 'a = b', '', 'c = d', '$$', '',
    '<!--', 'note', '', 'more', '-->', '',
    'Tail.', '',
  ].join('\n');
  const blocks = splitMarkdownBlocks(reply);
  assert.equal(blocks.join(''), reply);
  assert.deepEqual(blocks.map((block) => block.split('\n')[0]), [
    'Intro paragraph.',
    // Blank lines inside a fence, display math or a comment are not boundaries.
    '```ts',
    // A loose list stays whole; so does indented text after a blank line.
    '1. First',
    '$$',
    '<!--',
    'Tail.',
  ]);
  // Streamed one character at a time, every finished piece is final: a moved
  // boundary would re-render an earlier block (an unfinished "2" is not yet a list item).
  for (let end = 1; end <= reply.length; end += 1) {
    const finished = splitMarkdownBlocks(reply.slice(0, end)).slice(0, -1);
    assert.deepEqual(finished, blocks.slice(0, finished.length), `pieces changed at ${end} characters`);
  }
});

test('the plan banner re-reads a stored plan after each change, and takes a stated plan as it stands', () => {
  const row = (kind: string, extra: Record<string, unknown> = {}) => ({
    id: `${kind}-${Math.random()}`, sessionId: 's', timestamp: '2026-10-10T00:00:00Z', provider: 'claude', kind, ...extra,
  }) as any;
  const todo = row('tool_use', { toolName: 'TodoWrite', toolId: 't1', toolInput: JSON.stringify({ todos: [{ content: 'Read', status: 'completed' }, { content: 'Write', status: 'in_progress', activeForm: 'Writing' }] }) });
  const create = row('tool_use', { toolName: 'TaskCreate', toolId: 'c1', toolInput: '{"subject":"Ship"}' });
  const created = row('tool_result', { toolId: 'c1', content: 'ok' });
  const pushed = row('plan_updated', { plan: { steps: [{ id: '1', subject: 'Live', status: 'pending' }] } });

  assert.deepEqual(readPlanSignals([todo]).stated?.steps.map((step) => `${step.subject}:${step.status}`), ['Read:completed', 'Write:in_progress']);
  assert.equal(readPlanSignals([todo]).stated?.steps[1].activeForm, 'Writing');
  assert.deepEqual(readPlanSignals([create]), { revision: 0, stated: null }, 'a call still running changes nothing yet');
  const afterStored = readPlanSignals([todo, create, created]);
  assert.equal(afterStored.revision, 1);
  assert.equal(afterStored.stated, null, 'a stored change outranks an earlier stated plan');
  assert.equal(readPlanSignals([create, created, pushed]).stated?.steps[0].subject, 'Live', 'a pushed plan outranks an earlier stored change');
});

test('a finished plan becomes a card at the end of its turn, rebuilt from any provider\'s plan calls', () => {
  let seq = 0;
  const row = (kind: string, extra: Record<string, unknown> = {}) => ({
    id: `r${seq += 1}`, sessionId: 's', timestamp: '2026-10-13T00:00:00Z', provider: 'claude', kind, ...extra,
  }) as any;
  const ok = (toolUseResult?: unknown, content = '') => ({ content, isError: false, toolUseResult });
  const todos = (...statuses: string[]) => row('tool_use', {
    toolName: 'TodoWrite', toolId: `t${seq}`, toolInput: JSON.stringify({ todos: statuses.map((status, index) => ({ content: `Step ${index + 1}`, status })) }),
  });
  const create = (subject: string, result: unknown) => row('tool_use', { toolName: 'TaskCreate', toolId: `c${seq}`, toolInput: JSON.stringify({ subject }), toolResult: result });
  const update = (taskId: string, status: string, result: unknown = ok()) => row('tool_use', { toolName: 'TaskUpdate', toolId: `u${seq}`, toolInput: JSON.stringify({ taskId, status }), toolResult: result });
  const subjects = (records: any[]) => [...findFinishedPlans(records).values()].map((plan) => plan.steps.map((step) => step.subject).join(','));

  // Whole-list calls: one card when the list first reads all done, not again when it is restated.
  const listFinish = todos('completed', 'completed');
  const listed = [todos('completed', 'in_progress'), listFinish, todos('completed', 'completed')];
  assert.deepEqual([...findFinishedPlans(listed).keys()], [listFinish]);

  // Single-task calls take the id from structured output, else from the result text; a failed call changes nothing.
  const tasks = [
    create('Read', ok({ task: { id: '1', subject: 'Read' } })),
    create('Write', ok(undefined, 'Task #2 created successfully: Write')),
    update('1', 'completed'),
    update('2', 'completed', { content: 'no such task', isError: true }),
    update('2', 'completed'),
    create('Ship', ok({ task: { id: '3', subject: 'Ship' } })),
    update('3', 'completed'),
  ];
  assert.deepEqual(subjects(tasks), ['Read,Write', 'Ship'], 'a task created after a finished plan starts the next one');
  assert.deepEqual(subjects([update('7', 'completed')]), [], 'a step whose creation is on an unloaded page is never guessed');
  assert.deepEqual(subjects([update('9', 'deleted'), create('Only', ok({ task: { id: '1' } })), update('1', 'completed')]), ['Only']);

  // Codex: history keeps update_plan calls, live sessions push plan_updated.
  const codexPlan = JSON.stringify({ plan: [{ step: 'Scan', status: 'completed' }, { step: 'Fix', status: 'completed' }] });
  assert.deepEqual(subjects([row('tool_use', { provider: 'codex', toolName: 'update_plan', toolId: 'p1', toolInput: codexPlan })]), ['Scan,Fix']);
  assert.deepEqual(subjects([row('plan_updated', { provider: 'codex', plan: { steps: [{ id: '1', subject: 'Live', status: 'completed' }] } })]), ['Live']);
  assert.deepEqual(subjects([{ ...listFinish, parentToolUseId: 'agent-1' }]), [], 'a subagent\'s own checklist is not the session\'s plan');

  // The card closes the turn: after its reply, before the next prompt, never between its activity rows.
  const prompt = (content: string) => row('text', { role: 'user', content });
  const reply = row('text', { role: 'assistant', content: 'All steps done.' });
  const chat = normalizedToChatMessages([prompt('Go'), todos('in_progress'), todos('completed'), reply, prompt('Next')]);
  const cardAt = chat.findIndex((message) => message.finishedPlan);
  assert.equal(chat[cardAt - 1]?.content, 'All steps done.');
  assert.equal(chat[cardAt + 1]?.content, 'Next');
  assert.equal(chat.filter((message) => message.finishedPlan).length, 1);
  assert.ok(isSamePlan(chat[cardAt].finishedPlan, { steps: [{ id: 'x', subject: 'Step 1', status: 'completed' }] }));
  assert.ok(!isSamePlan(chat[cardAt].finishedPlan, { steps: [{ id: '1', subject: 'Other', status: 'completed' }] }));
});

test('background work lists every agent and background command, with how each ended', () => {
  const agent = (id: string, extra: Partial<ChatMessage>): ChatMessage => ({
    id, timestamp: '2026-10-10T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Agent', toolId: id,
    isSubagentContainer: true, toolInput: JSON.stringify({ subagent_type: 'Explore', description: `Agent ${id}` }), ...extra,
  });
  const done = { content: 'ok', isError: false };
  const messages: ChatMessage[] = [
    agent('foreground', {}),
    agent('finished', { toolResult: done }),
    agent('background', { toolResult: done, subagentState: { childTools: [], currentToolIndex: -1, isComplete: false, agentStatus: { taskId: 't-9', state: 'running', toolUses: 4 } } }),
    agent('stopped', { subagentState: { childTools: [], currentToolIndex: -1, isComplete: true, agentStatus: { taskId: 't-2', state: 'stopped' } } }),
    { id: 'read', timestamp: '2026-10-10T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Read' },
    {
      id: 'bash', timestamp: '2026-10-10T00:00:00Z', type: 'assistant', content: '', isToolUse: true, toolName: 'Bash', toolId: 'bash',
      toolInput: JSON.stringify({ command: 'npm run build', description: 'Build' }), backgroundState: 'running',
      toolResult: { content: '', isError: false, toolUseResult: { backgroundTaskId: 'b1' } },
    },
  ];
  const live = listBackgroundWork(messages, true);
  assert.deepEqual(live.map((item) => `${item.key}:${item.kind}:${item.state}`), [
    'foreground:agent:running', 'finished:agent:completed', 'background:agent:running', 'stopped:agent:stopped', 'bash:command:running',
  ]);
  assert.equal(live[2].taskId, 't-9');
  assert.equal(live[2].callCount, 4);
  assert.equal(live[4].taskId, 'b1');
  assert.equal(live[4].title, 'npm run build');
  // A run that closed with work still reading running cannot say how it ended.
  assert.deepEqual(listBackgroundWork(messages, false).filter((item) => item.state === 'ended').map((item) => item.key), ['foreground', 'background', 'bash']);
  // Work on an unloaded page comes from the stored records; a loaded copy wins.
  const stored = listBackgroundWork([{ ...messages[1], timestamp: '2026-10-09T00:00:00Z' }, { ...messages[0], id: 'older', toolId: 'older', timestamp: '2026-10-08T00:00:00Z' }], true);
  const merged = mergeBackgroundWork(live, stored);
  assert.deepEqual(merged.map((item) => item.key), ['older', 'foreground', 'finished', 'background', 'stopped', 'bash']);
  assert.equal(merged.find((item) => item.key === 'finished')?.message, messages[1]);
  // The provider's live list decides what runs, and adds what an agent launched.
  const withTasks = applyLiveTasks(live, [
    { taskId: 't-2', kind: 'agent', description: 'Agent stopped' },
    { taskId: 'sub-sh', kind: 'command', description: 'until done; do sleep 2; done', parentTaskId: 't-9' },
  ]);
  assert.equal(withTasks.find((item) => item.key === 'stopped')?.state, 'running');
  assert.deepEqual(withTasks.at(-1), {
    key: 'task:sub-sh', kind: 'command', title: 'until done; do sleep 2; done', description: '', state: 'running', taskId: 'sub-sh',
    callCount: 0, durationMs: null, message: { type: 'assistant', content: '', timestamp: '' }, launchedBy: 'Agent background', liveOnly: true,
  });
  assert.equal(applyLiveTasks(live, undefined), live);
});

test('a background command reads running until its notice, which then adds nothing to the chat', () => {
  const row = (extra: Record<string, unknown>) => ({ sessionId: 's', timestamp: '2026-10-10T00:00:00Z', provider: 'claude', ...extra }) as any;
  const launch = row({ id: 'u1', kind: 'tool_use', toolName: 'Bash', toolId: 'toolu_bg', toolInput: { command: 'npm run build', run_in_background: true } });
  const launched = row({ id: 'r1', kind: 'tool_result', toolId: 'toolu_bg', content: 'Command running in background', toolUseResult: { stdout: '', backgroundTaskId: 'b1' } });
  const other = row({ id: 'u2', kind: 'tool_use', toolName: 'Read', toolId: 'toolu_read', toolInput: { file_path: '/a.ts' }, toolResult: { content: 'x' } });
  const notice = row({
    id: 'n1', kind: 'text', role: 'user',
    content: '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n<summary>Background command "npm run build" completed (exit code 0)</summary>\n</task-notification>',
  });

  const running = normalizedToChatMessages([launch, launched, other]);
  assert.equal(running[0].backgroundState, 'running');
  assert.equal(describeOperation(running[0]).status, 'running');
  assert.equal(groupToolActivities(running).length, 2, 'the command is an activity of its own');

  const finished = normalizedToChatMessages([launch, launched, other, notice]);
  assert.equal(finished.length, 2, 'the notice renders nothing');
  assert.equal(finished[0].backgroundState, 'completed');
  assert.equal(describeOperation(finished[0]).status, 'completed');
});

test('a background agent takes its report from its completion notice, not its launch receipt', () => {
  const row = (extra: Record<string, unknown>) => ({ sessionId: 's', timestamp: '2026-10-10T00:00:00Z', provider: 'claude', ...extra }) as any;
  const launch = row({ id: 'u1', kind: 'tool_use', toolName: 'Agent', toolId: 'toolu_agent', toolInput: { subagent_type: 'Explore', prompt: 'Look' } });
  const receipt = row({ id: 'r1', kind: 'tool_result', toolId: 'toolu_agent', content: 'Async agent launched successfully.', toolUseResult: { status: 'async_launched' } });
  const notice = row({
    id: 'n1', kind: 'text', role: 'user',
    content: '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>Found 3 callers.</result>\n</task-notification>',
  });
  const [agent, ...rest] = normalizedToChatMessages([launch, receipt, notice]);
  assert.equal(agent.subagentState?.report, 'Found 3 callers.');
  assert.equal(agent.subagentState?.agentStatus?.state, 'completed');
  assert.equal(rest.length, 0, 'the notice adds nothing to the chat');
});

test('a hand-back report beats the notice that points at it, and a notice naming a call never renders', () => {
  const row = (extra: Record<string, unknown>) => ({ sessionId: 's', timestamp: '2026-10-10T00:00:00Z', provider: 'claude', ...extra }) as any;
  const launch = row({ id: 'u1', kind: 'tool_use', toolName: 'Agent', toolId: 'toolu_agent', toolInput: { subagent_type: 'Explore', prompt: 'Look' } });
  const receipt = row({ id: 'r1', kind: 'tool_result', toolId: 'toolu_agent', content: 'Async agent launched successfully.', toolUseResult: { status: 'async_launched', agentId: 'a1' } });
  const handback = row({ id: 'h1', kind: 'agent_status', agentStatus: { taskId: 'a1', state: 'completed', report: 'The time is 16:15.' } });
  const notice = row({
    id: 'n1', kind: 'text', role: 'user',
    content: '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>This agent\'s report was delivered to you (its SubagentHandback call).</result>\n<usage><tool_uses>12</tool_uses><duration_ms>100143</duration_ms></usage>\n</task-notification>',
  });

  // Newest page first: its call is on an unloaded page, and the background-work list carries it.
  assert.deepEqual(normalizedToChatMessages([notice]), []);

  const [agent, ...rest] = normalizedToChatMessages([launch, receipt, handback, notice]);
  assert.equal(agent.subagentState?.report, 'The time is 16:15.');
  assert.equal(agent.subagentState?.agentStatus?.durationMs, 100143);
  assert.equal(rest.length, 0, 'the notice renders nothing');
});
