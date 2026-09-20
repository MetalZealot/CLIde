// Chat-hook regressions: composer routing and settings, queued-send ordering,
// realtime request de-duplication, message normalization, and voice playback.
import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { createRoot } from 'react-dom/client';

import { historyBudgets } from '../../../../scripts/chat-history/budgets.js';
import { useChatBrowser } from '../../browser-use/useChatBrowser';
import { useAsyncAnswerQueueAutoSend } from '../../../hooks/useAsyncAnswerQueueAutoSend';
import { useQueuedMessageAutoSend } from '../../../hooks/useQueuedMessageAutoSend';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import { formatPlaybackTime, VoicePlayer, voiceId } from '../../../lib/voicePlayer';
import { api } from '../../../utils/api';
import { asyncQuestionDraftKey, enqueueAsyncAnswer, readHandledAsyncQuestions } from '../utils/asyncQuestionState';
import { writeQueuedMessage } from '../utils/chatStorage';
import { resolveEffortValuesForModel } from '../constants/providerEffort';

import { useAsyncQuestions } from './useAsyncQuestions';
import { useChatSessionState } from './useChatSessionState';
import {
  describeDropRejections,
  resolveComposerTabAction,
  resolveSessionSendSetting,
  resolveUsagePopoverView,
  selectPastedAttachments,
} from './useChatComposerState';
import { resolveAutoContinueOffer } from './useAutoContinueOffer';
import { normalizedToChatMessages } from './useChatMessages';
import { resolveHistoryNavigation, type HistoryNav } from './useInputHistory';
import { reconcileEffortForAllowedValues } from './useChatProviderState';
import { appendStreamChunk, dedupePermissionRequestsById } from './useChatRealtimeHandlers';
import { normalizeVoiceTranscript } from './useVoiceInput';
import {
  collectChatFindOccurrences,
  isChatFindConversationMessage,
  stepChatFindIndex,
  useChatFind,
  type ChatFindController,
} from './useChatFind';

// --- useChatFind ------------------------------------------------------------

test('chat find searches marked conversation content and excludes controls and metadata', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="chat-message" data-chat-find-scope="conversation">
      <div data-chat-find-content>A <strong>Needle</strong> beside NEEDLE<button>needle action</button></div>
      <span>needle timestamp</span>
    </div>
    <div class="chat-message" data-chat-find-scope="conversation">
      <div data-chat-find-content>Literal a+b</div>
      <button><span data-chat-find-content>needle option</span></button>
      <span data-chat-find-content>cross</span><span data-chat-find-content>boundary</span>
      <span class="sr-only" data-chat-find-content>needle hidden</span>
    </div>
    <div class="chat-message tool"><div data-chat-find-content>needle tool result</div></div>
  `;

  const words = collectChatFindOccurrences(root, 'needle');
  assert.deepEqual(words.map((occurrence) => occurrence.range.toString()), ['Needle', 'NEEDLE', 'needle']);
  assert.deepEqual(
    collectChatFindOccurrences(root, 'a+b').map((occurrence) => occurrence.range.toString()),
    ['a+b'],
  );
  assert.equal(collectChatFindOccurrences(root, 'crossboundary').length, 0);
});

test('chat find does not double-count text inside nested message containers', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="chat-message tool">
      Tool group
      <div class="chat-message" data-chat-find-scope="conversation">
        <div data-chat-find-content>one match</div>
      </div>
    </div>
  `;

  const matches = collectChatFindOccurrences(root, 'match');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.messageElement.textContent?.trim(), 'one match');
});

test('chat find includes authored turns and excludes transcript activity rows', () => {
  const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
    type: 'assistant',
    content: 'text',
    timestamp: '2026-09-11T00:00:00.000Z',
    ...overrides,
  });

  assert.equal(isChatFindConversationMessage(message({ type: 'user' })), true);
  assert.equal(isChatFindConversationMessage(message({})), true);
  assert.equal(isChatFindConversationMessage(message({ followUpQuestions: [{ question: 'Question?', options: [] }] })), true);
  assert.equal(isChatFindConversationMessage(message({ isInteractivePrompt: true })), true);
  assert.equal(isChatFindConversationMessage(message({ isToolUse: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isThinking: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isCompactSummary: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isCompactBoundary: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isSystemNotice: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isTaskNotification: true })), false);
  assert.equal(isChatFindConversationMessage(message({ isLocalCommandStdout: true })), false);
  assert.equal(isChatFindConversationMessage(message({ type: 'error' })), false);
});

test('chat find navigation wraps in both directions', () => {
  assert.equal(stepChatFindIndex(2, 3, 1), 0);
  assert.equal(stepChatFindIndex(0, 3, -1), 2);
  assert.equal(stepChatFindIndex(-1, 3, 1), 0);
  assert.equal(stepChatFindIndex(-1, 0, 1), -1);
});

test('chat find waits for complete history and closes on Escape or session change', async () => {
  const host = document.createElement('div');
  const previousFocus = document.createElement('button');
  document.body.append(previousFocus, host);
  previousFocus.focus();
  const root = createRoot(host);
  let controller: ChatFindController | undefined;
  let resolveHistory!: (messages: ChatMessage[]) => void;
  const history = new Promise<ChatMessage[]>((resolve) => { resolveHistory = resolve; });
  const chatMessages: ChatMessage[] = [];
  let loadCalls = 0;
  const loadAllMessages = async () => {
    loadCalls += 1;
    return history;
  };

  function Harness({ sessionId }: { sessionId: string }) {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const messagesContentRef = React.useRef<HTMLDivElement>(null);
    controller = useChatFind({
      isVisible: true,
      sessionId,
      chatMessages,
      loadAllMessages,
      scrollContainerRef,
      messagesContentRef,
    });
    return React.createElement(
      'div',
      { ref: scrollContainerRef },
      React.createElement(
        'div',
        { ref: messagesContentRef },
        React.createElement(
          'div',
          { className: 'chat-message', 'data-chat-find-scope': 'conversation' },
          React.createElement('div', { 'data-chat-find-content': true }, 'Needle and needle again'),
        ),
      ),
    );
  }

  try {
    await React.act(async () => root.render(React.createElement(Harness, { sessionId: 'session-1' })));
    await React.act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    assert.equal(controller!.isOpen, true);
    assert.equal(controller!.isPreparing, true);
    assert.equal(loadCalls, 0, 'opening find does not synchronously load history');

    await React.act(async () => controller!.setQuery('needle'));
    assert.equal(controller!.total, 0);
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    assert.equal(loadCalls, 1);
    await React.act(async () => resolveHistory([]));
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    assert.equal(controller!.isPreparing, false);
    assert.equal(controller!.total, 2);

    await React.act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    await React.act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    assert.equal(controller!.isOpen, false);
    assert.equal(document.activeElement, previousFocus);

    await React.act(async () => controller!.open());
    assert.equal(controller!.isOpen, true);
    await React.act(async () => root.render(React.createElement(Harness, { sessionId: 'session-2' })));
    assert.equal(controller!.isOpen, false);
  } finally {
    await React.act(async () => root.unmount());
    previousFocus.remove();
    host.remove();
  }
});

test('find reveals cached history again after jump to bottom without refetching', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const messages: NormalizedMessage[] = Array.from({ length: 120 }, (_, index) => ({
    id: String(index), kind: 'text', role: 'assistant', provider: 'codex',
    content: index === 0 ? 'older unique needle' : 'recent text',
    timestamp: '2026-09-12T00:00:00.000Z', sessionId: 'find-cached',
  }));
  const slot = { hasMore: false, status: 'loaded' };
  let fetches = 0;
  const sessionStore = {
    getMessages: () => messages, getSessionSlot: () => slot,
    setActiveSession: () => undefined, isStale: () => false,
    fetchSessionSettings: () => undefined,
    fetchFromServer: async () => { fetches += 1; return slot; },
  } as unknown as SessionStore;
  const args: Parameters<typeof useChatSessionState>[0] = {
    selectedProject: { projectId: 'project', displayName: 'project', fullPath: '/tmp/find-fixture', path: '/tmp/find-fixture' },
    selectedSession: { id: 'find-cached', __provider: 'codex' },
    ws: null, sendMessage: () => true, resetStreamingState: () => undefined,
    statusCheckSentAtRef: { current: new Map() }, getReplayProgress: () => null, sessionStore,
  };
  let state!: ReturnType<typeof useChatSessionState>;
  let find!: ChatFindController;
  function Harness() {
    state = useChatSessionState(args);
    find = useChatFind({
      isVisible: true, sessionId: 'find-cached', chatMessages: state.chatMessages,
      loadAllMessages: state.loadAllMessages,
      scrollContainerRef: state.scrollContainerRef, messagesContentRef: state.messagesContentRef,
    });
    return React.createElement('div', { ref: state.scrollContainerRef },
      React.createElement('div', { ref: state.messagesContentRef }, state.visibleMessages.map((message) => (
        React.createElement('div', { key: message.id, className: 'chat-message', 'data-chat-find-scope': 'conversation' },
          React.createElement('div', { 'data-chat-find-content': true }, message.content))
      ))));
  }
  const settle = async () => {
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  };
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(state.visibleMessages.length, 100);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await React.act(async () => { find.open(); });
      await React.act(async () => { find.setQuery('older unique needle'); });
      await settle();
      assert.equal(find.total, 1, 'the oldest cached message must be searchable');
      assert.equal(state.visibleMessages.length, 120);
      assert.equal(fetches, 0, 'complete cached history must not be downloaded again');
      await React.act(async () => { find.close(); state.scrollToBottomAndReset(); });
      assert.equal(state.visibleMessages.length, 100);
    }
  } finally {
    await React.act(async () => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
  }
});

// --- useInputHistory --------------------------------------------------------

const HISTORY = ['first', 'second', 'third'];
const readHistory = () => HISTORY;
const navAt = (index: number, draft = ''): HistoryNav => ({
  history: HISTORY,
  index,
  draft,
  recalled: HISTORY[index],
});

test('ArrowUp in an empty box recalls the newest message', () => {
  const result = resolveHistoryNavigation('ArrowUp', '', null, readHistory);
  assert.deepEqual(result, {
    handled: true,
    nav: { history: HISTORY, index: 2, draft: '', recalled: 'third' },
    input: 'third',
  });
});

test('ArrowUp leaves a box the user has typed in alone', () => {
  assert.deepEqual(
    resolveHistoryNavigation('ArrowUp', 'half a thought', null, readHistory),
    { handled: false },
  );
});

test('ArrowUp walks backwards, then stops at the oldest without clearing the box', () => {
  const second = resolveHistoryNavigation('ArrowUp', 'third', navAt(2), readHistory);
  assert.equal(second.handled && second.input, 'second');

  const first = resolveHistoryNavigation('ArrowUp', 'second', navAt(1), readHistory);
  assert.equal(first.handled && first.input, 'first');

  // Consumed, so the caret does not jump, but nothing changes.
  const oldest = resolveHistoryNavigation('ArrowUp', 'first', navAt(0), readHistory);
  assert.equal(oldest.handled && oldest.input, null);
});

test('ArrowDown past the newest entry restores the draft that recall interrupted', () => {
  const result = resolveHistoryNavigation('ArrowDown', 'third', navAt(2, 'my draft'), readHistory);
  assert.deepEqual(result, { handled: true, nav: null, input: 'my draft' });
});

test('editing a recalled message hands the arrows back', () => {
  assert.deepEqual(
    resolveHistoryNavigation('ArrowUp', 'third and a bit', navAt(2), readHistory),
    { handled: false },
  );
  assert.deepEqual(
    resolveHistoryNavigation('ArrowDown', 'third and a bit', navAt(2), readHistory),
    { handled: false },
  );
});

test('ArrowDown outside a recall is never taken over', () => {
  assert.deepEqual(
    resolveHistoryNavigation('ArrowDown', '', null, readHistory),
    { handled: false },
  );
});

test('an empty history leaves ArrowUp as caret movement', () => {
  assert.deepEqual(
    resolveHistoryNavigation('ArrowUp', '', null, () => []),
    { handled: false },
  );
});

test('a walk in progress keeps its own snapshot, not a later read', () => {
  // A send from another tab appends mid-recall; the arrows must keep landing
  // on the list the walk started with.
  const grown = () => [...HISTORY, 'fourth'];
  const result = resolveHistoryNavigation('ArrowUp', 'third', navAt(2), grown);
  assert.equal(result.handled && result.input, 'second');
  assert.deepEqual(result.handled && result.nav?.history, HISTORY);
});

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

for (const recovery of ['completion', 'reconnect', 'timeout', 'accepted', 'rejected', 'session switch'] as const) {
  test(`async-answer delivery handles ${recovery}`, async (t) => {
    const sessionId = `lost-ack-${recovery}`;
    const question = { id: 'question:0', messageId: 'question', question: 'Continue?', options: ['Yes'] };
    const messages: ChatMessage[] = [{
      id: 'question', type: 'assistant', content: '', timestamp: new Date(),
      followUpQuestions: [question],
    }];
    let controller: ReturnType<typeof useAsyncQuestions> | undefined;
    let listener: ((event: ServerEvent) => void) | undefined;
    let timeout: (() => void) | undefined;
    const sent: unknown[] = [];
    const refreshed: string[] = [];
    const appended: unknown[] = [];
    const subscribe = (callback: (event: ServerEvent) => void) => {
      listener = callback;
      return () => { listener = undefined; };
    };
    const sessionStore = {
      appendRealtime: (...args: unknown[]) => appended.push(args),
      refreshFromServer: async (id: string) => { refreshed.push(id); },
    } as unknown as SessionStore;
    t.mock.method(window, 'setTimeout', (callback: () => void) => {
      timeout = callback;
      return 1;
    });
    const clearTimer = t.mock.method(window, 'clearTimeout', () => {});
    const root = createRoot(document.createElement('div'));
    function Harness({ processing, activeSession = sessionId }: { processing: boolean; activeSession?: string }) {
      controller = useAsyncQuestions({
        sessionId: activeSession, provider: 'codex', messages, isProcessing: processing,
        sendOptions: {}, sendMessage: (message) => { sent.push(message); return true; },
        subscribe, sessionStore,
      });
      return null;
    }
    try {
      await React.act(async () => root.render(React.createElement(Harness, { processing: true })));
      localStorage.setItem(asyncQuestionDraftKey(sessionId, question.id), 'My answer');
      await React.act(async () => { controller!.submit(question, 'My answer', 'send'); });
      assert.equal(controller!.sendingQuestionId, question.id);
      if (recovery === 'accepted' || recovery === 'rejected') {
        await React.act(async () => listener!({
          kind: recovery === 'accepted' ? 'chat_input_accepted' : 'chat_input_rejected',
          requestId: (sent[0] as { requestId: string }).requestId,
          sessionId, error: 'Not accepted',
        }));
        await React.act(async () => timeout?.());
        assert.equal(controller!.sendingQuestionId, null);
        assert.deepEqual(refreshed, [], 'settled requests must not time out');
        assert.equal(appended.length, recovery === 'accepted' ? 1 : 0);
        assert.equal(readHandledAsyncQuestions(sessionId).length, recovery === 'accepted' ? 1 : 0);
        assert.equal(controller!.error, recovery === 'accepted' ? null : 'Not accepted');
        return;
      }
      if (recovery === 'session switch') {
        await React.act(async () => root.render(React.createElement(Harness, {
          processing: true, activeSession: 'other-session',
        })));
        await React.act(async () => timeout?.());
        assert.equal(controller!.sendingQuestionId, null);
        assert.equal(controller!.error, null, 'old-session timeout must not alter the new session');
        assert.deepEqual(refreshed, [sessionId]);
        return;
      }
      await React.act(async () => {
        if (recovery === 'completion') root.render(React.createElement(Harness, { processing: false }));
        else if (recovery === 'reconnect') listener!({ kind: 'websocket_reconnected' });
        else timeout?.();
      });
      assert.equal(controller!.sendingQuestionId, null);
      assert.match(controller!.error ?? '', /confirm.*delivery|delivery.*confirm/i);
      assert.equal(controller!.pendingQuestion?.id, question.id);
      assert.equal(localStorage.getItem(asyncQuestionDraftKey(sessionId, question.id)), 'My answer');
      assert.deepEqual(readHandledAsyncQuestions(sessionId), []);
      assert.deepEqual(refreshed, [sessionId]);
      assert.equal(sent.length, 1, 'recovery must never resend an uncertain answer');
      assert.equal(appended.length, 0, 'an uncertain answer is not an accepted local echo');
      assert.ok(clearTimer.mock.callCount() > 0);

      // A refreshed transcript can confirm delivery without another send.
      messages.push({ id: 'native-answer', type: 'user', content: '> Continue?\n\nMy answer', timestamp: new Date() });
      await React.act(async () => root.render(React.createElement(Harness, { processing: false })));
      assert.equal(controller!.pendingQuestion, null);
      assert.equal(sent.length, 1);
    } finally {
      await React.act(async () => root.unmount());
      const refreshCount = refreshed.length;
      timeout?.();
      assert.equal(refreshed.length, refreshCount, 'unmounted requests must not recover');
      localStorage.clear();
    }
  });
}

test('a composer message dispatches before a queued async answer', async () => {
  const sessionId = `queue-priority-${Date.now()}`;
  const sent: Array<{ content?: string }> = [];
  const originalRunningSessions = api.runningSessions;
  const originalWebSocket = globalThis.WebSocket;
  const host = document.createElement('div');
  const root = createRoot(host);
  let markIdle: (() => void) | null = null;

  class OpenWebSocket {
    static readonly OPEN = 1;
    readonly readyState = OpenWebSocket.OPEN;
  }

  writeQueuedMessage(sessionId, { content: 'COMPOSER-FIRST' });
  enqueueAsyncAnswer(sessionId, {
    id: 'async-answer-1',
    questionId: 'question-1',
    question: 'Continue?',
    answer: 'Yes',
    content: '> Continue?\n\nYes',
    provider: 'codex',
    queuedAt: '2026-09-07T12:00:00.000Z',
  });

  globalThis.WebSocket = OpenWebSocket as unknown as typeof WebSocket;
  api.runningSessions = async () => new Response(JSON.stringify({ data: { sessions: [] } }));
  document.body.appendChild(host);

  function Harness() {
    const [processingSessions, setProcessingSessions] = React.useState(new Map([[
      sessionId,
      { statusText: null, canInterrupt: true, startedAt: Date.now() },
    ]]));
    const markSessionProcessing = React.useCallback((targetSessionId?: string | null) => {
      if (!targetSessionId) return;
      setProcessingSessions((previous) => new Map(previous).set(targetSessionId, {
        statusText: null,
        canInterrupt: true,
        startedAt: Date.now(),
      }));
    }, []);
    markIdle = () => setProcessingSessions(new Map());

    const ws = React.useMemo(() => new OpenWebSocket() as unknown as WebSocket, []);
    const sendMessage = React.useCallback((message: unknown) => {
      sent.push(message as { content?: string });
      return true;
    }, []);

    useQueuedMessageAutoSend({
      processingSessions,
      activeSessionId: null,
      ws,
      sendMessage,
      markSessionProcessing,
    });
    useAsyncAnswerQueueAutoSend({
      processingSessions,
      ws,
      sendMessage,
      markSessionProcessing,
    });
    return null;
  }

  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    await React.act(async () => markIdle?.());
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 850));
    });
    assert.deepEqual(sent.map((message) => message.content), ['COMPOSER-FIRST']);

    await React.act(async () => markIdle?.());
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 850));
    });
    assert.deepEqual(sent.map((message) => message.content), [
      'COMPOSER-FIRST',
      '> Continue?\n\nYes',
    ]);
  } finally {
    await React.act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    api.runningSessions = originalRunningSessions;
    globalThis.WebSocket = originalWebSocket;
  }
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

test('a catalog model with no effort values offers none, hiding the picker', () => {
  assert.deepEqual(resolveEffortValuesForModel({ value: 'haiku', label: 'Haiku 4.5' }, ['low', 'high']), []);
});

test('a model absent from the catalog falls back to the provider values', () => {
  assert.deepEqual(resolveEffortValuesForModel(null, ['low', 'high']), [{ value: 'low' }, { value: 'high' }]);
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

// --- useVoiceInput ---------------------------------------------------------

test('blank-audio sentinels never become composer text', () => {
  assert.equal(normalizeVoiceTranscript('[BLANK_AUDIO]'), '');
  assert.equal(normalizeVoiceTranscript('  [blank_audio]  '), '');
  assert.equal(normalizeVoiceTranscript('Three spoken words'), 'Three spoken words');
});

test('playback times stay compact beside the message control', () => {
  assert.equal(formatPlaybackTime(3), '0:03');
  assert.equal(formatPlaybackTime(62), '1:02');
  assert.equal(formatPlaybackTime(3723), '1:02:03');
});

test('read-aloud pauses, resumes, restarts, and follows external media controls', async () => {
  class FakeAudio {
    static latest: FakeAudio | null = null;
    src = '';
    currentTime = 0;
    duration = 62;
    playbackRate = 1;
    paused = true;
    private listeners = new Map<string, Set<() => void>>();

    constructor() {
      FakeAudio.latest = this;
    }

    addEventListener(type: string, listener: () => void) {
      const listeners = this.listeners.get(type) ?? new Set<() => void>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    private emit(type: string) {
      this.listeners.get(type)?.forEach((listener) => listener());
    }

    load() {
      this.emit('loadedmetadata');
    }

    play(): Promise<void> {
      this.paused = false;
      this.emit('play');
      return Promise.resolve();
    }

    pause() {
      if (this.paused) return;
      this.paused = true;
      this.emit('pause');
    }

    seek(seconds: number) {
      this.currentTime = seconds;
      this.emit('timeupdate');
    }
  }

  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeAudio,
  });

  try {
    const content = 'Playback state test';
    const id = voiceId(content);
    let resolveSynthesis!: (response: Response) => void;
    const synthesis = new Promise<Response>((resolve) => {
      resolveSynthesis = resolve;
    });
    let synthesisCalls = 0;
    const player = new VoicePlayer(() => (
      synthesisCalls++ === 0
        ? synthesis
        : Promise.resolve(new Response(new Blob(['audio'])))
    ));
    const waitForState = async (targetId: string, expected: 'playing' | 'paused') => {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (player.getSnapshot(targetId).state === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    player.unlock();
    player.toggle(content);
    const audio = FakeAudio.latest;
    assert.ok(audio);
    // A fresh browser can deliver the unlock's Play/Pause events late. They
    // must not replace Loading with false playback controls.
    await audio.play();
    audio.pause();
    assert.equal(player.getSnapshot(id).state, 'loading');

    resolveSynthesis(new Response(new Blob(['audio'])));
    await waitForState(id, 'playing');
    assert.deepEqual(player.getSnapshot(id), {
      state: 'playing',
      error: null,
      currentTime: 0,
      duration: 62,
      generationElapsedSeconds: 0,
    });

    audio.seek(3);
    assert.deepEqual(player.getSnapshot(id), {
      state: 'playing',
      error: null,
      currentTime: 3,
      duration: 62,
      generationElapsedSeconds: 0,
    });

    audio.pause();
    assert.equal(player.getSnapshot(id).state, 'paused');
    player.toggle(content);
    await waitForState(id, 'playing');
    assert.equal(player.getSnapshot(id).state, 'playing');

    audio.seek(14);
    player.pause();
    player.restart();
    await waitForState(id, 'playing');
    assert.equal(player.getSnapshot(id).state, 'playing');
    assert.equal(player.getSnapshot(id).currentTime, 0);

    const replacement = 'Higher-priority playback';
    const replacementId = voiceId(replacement);
    player.toggle(replacement);
    await waitForState(replacementId, 'playing');
    assert.equal(player.getSnapshot(id).state, 'idle');
    assert.equal(player.getSnapshot(replacementId).state, 'playing');
    player.stop();
  } finally {
    if (audioDescriptor) Object.defineProperty(globalThis, 'Audio', audioDescriptor);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

test('a newer read-aloud waits for an explicitly stopped generation to cancel', async () => {
  class FakeAudio {
    currentTime = 0;
    duration = 5;
    playbackRate = 1;
    src = '';
    addEventListener() {}
    load() {}
    pause() {}
    play() { return Promise.resolve(); }
  }

  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeAudio,
  });

  try {
    const synthesisCalls: Array<{ content: string; jobId: string }> = [];
    const cancelledJobIds: string[] = [];
    let releaseCancellation!: () => void;
    const cancellationReleased = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const player = new VoicePlayer(
      (content, signal, jobId) => {
        synthesisCalls.push({ content, jobId });
        if (content === 'First generation') {
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          });
        }
        return Promise.resolve(new Response(new Blob(['audio'])));
      },
      async (jobId) => {
        cancelledJobIds.push(jobId);
        await cancellationReleased;
      },
    );

    player.toggle('First generation');
    await new Promise((resolve) => setTimeout(resolve, 0));
    player.toggle('First generation');
    player.toggle('Second generation');
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    assert.equal(synthesisCalls.length, 1);
    assert.deepEqual(cancelledJobIds, [synthesisCalls[0].jobId]);
    assert.equal(player.getSnapshot(voiceId('Second generation')).state, 'loading');
    assert.ok(
      player.getSnapshot(voiceId('Second generation')).generationElapsedSeconds >= 1,
    );

    releaseCancellation();
    for (let attempt = 0; attempt < 20; attempt++) {
      if (player.getSnapshot(voiceId('Second generation')).state === 'playing') break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(synthesisCalls.length, 2);
    assert.equal(synthesisCalls[1].content, 'Second generation');
    assert.equal(player.getSnapshot(voiceId('Second generation')).state, 'playing');
    player.stop();
  } finally {
    if (audioDescriptor) Object.defineProperty(globalThis, 'Audio', audioDescriptor);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
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


test('browser polling cannot carry another chat into the preview and stops while hidden', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const requests: Array<{ url: string; signal?: AbortSignal; resolve: (response: Response) => void }> = [];
  t.mock.method(globalThis, 'fetch', (url: string, options: RequestInit) => new Promise<Response>((resolve) => {
    requests.push({ url, signal: options.signal ?? undefined, resolve });
  }));
  let current: ReturnType<typeof useChatBrowser> = null;
  function Probe({ id, visible }: { id: string; visible: boolean }) {
    current = useChatBrowser(id, visible);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const reply = (chatSessionId: string, id: string) => new Response(JSON.stringify({
    success: true, data: { sessions: [{ chatSessionId, id, screenshotVersion: 0, updatedAt: '2026-09-11T12:00:00Z' }] },
  }), { status: 200 });
  try {
    await React.act(async () => root.render(React.createElement(Probe, { id: 'chat-a', visible: true })));
    assert.match(requests[0].url, /chatSessionId=chat-a/);
    await React.act(async () => root.render(React.createElement(Probe, { id: 'chat-b', visible: true })));
    assert.equal(requests[0].signal?.aborted, true);
    assert.equal(current, null);
    await React.act(async () => { requests[1].resolve(reply('chat-b', 'browser-b')); });
    assert.equal((current as ReturnType<typeof useChatBrowser>)?.session?.id, 'browser-b');
    await React.act(async () => { requests[0].resolve(reply('chat-a', 'browser-a')); });
    assert.equal((current as ReturnType<typeof useChatBrowser>)?.session?.id, 'browser-b');
    await React.act(async () => root.render(React.createElement(Probe, { id: 'chat-b', visible: false })));
    assert.equal(requests[1].signal?.aborted, true);
    assert.equal(requests.length, 2);
  } finally {
    await React.act(async () => root.unmount());
    if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
    else Reflect.deleteProperty(document, 'hidden');
  }
});

test('Auto-Continue is offered on the limit notice itself, not an earlier one', () => {
  const now = Date.parse('2026-09-09T23:00:00.000Z');
  const stop = { resumes: true, resetsAt: '2026-09-10T04:20:00.000Z', windowId: 'five_hour' };
  const older = { type: 'assistant', content: 'earlier limit', isSystemNotice: true, usageLimit: stop };
  const notice = { type: 'assistant', content: "You've hit your session limit", isSystemNotice: true, usageLimit: stop };
  const messages = [
    older,
    { type: 'assistant', content: 'work' },
    notice,
  ] as unknown as ChatMessage[];

  // The button is drawn by identity, so the offer has to name the live row.
  assert.equal(resolveAutoContinueOffer(messages, [], true, now), notice);
});

test('Auto-Continue is withheld when nothing will reset, or already has', () => {
  const now = Date.parse('2026-09-09T23:00:00.000Z');
  const withStop = (usageLimit: unknown) => ([
    { type: 'assistant', content: 'stopped', usageLimit },
  ] as unknown as ChatMessage[]);

  // A spent balance wants payment, not a wait.
  assert.equal(resolveAutoContinueOffer(withStop({ resumes: false }), [], true, now), null);
  // An old conversation whose reset came and went has nothing left to offer.
  assert.equal(
    resolveAutoContinueOffer(withStop({ resumes: true, resetsAt: '2026-09-09T22:00:00.000Z' }), [], true, now),
    null,
  );
  // Cursor and OpenCode have no usage reset to wait on.
  assert.equal(resolveAutoContinueOffer(withStop({ resumes: true }), [], false, now), null);
});

test('Auto-Continue steps aside for a message already waiting, and for a user who moved on', () => {
  const now = Date.parse('2026-09-09T23:00:00.000Z');
  const stopped = [
    { type: 'assistant', content: 'stopped', usageLimit: { resumes: true } },
  ] as unknown as ChatMessage[];
  const waiting = [{ id: 's1', trigger: 'usage-reset' }] as unknown as Parameters<typeof resolveAutoContinueOffer>[1];

  assert.equal(resolveAutoContinueOffer(stopped, waiting, true, now), null);
  assert.equal(
    resolveAutoContinueOffer([...stopped, { type: 'user', content: 'carry on' }] as unknown as ChatMessage[], [], true, now),
    null,
  );
});

// Opt-in strict mode keeps future performance targets red without breaking normal correctness checks.
test('history performance target: appending one row preserves unchanged display objects', async () => {
  const { clientHistory } = await import('../../../../scripts/chat-history/fixtures');
  const messages = clientHistory(1000);
  const first = normalizedToChatMessages(messages);
  const next = normalizedToChatMessages([...messages, { ...messages[0], id: 'new-row' }]);
  assert.equal(first.filter((message, index) => message !== next[index]).length, historyBudgets.unchangedRowsRecreated);
});

test('history performance target: Find keeps the rendered window bounded', {
  todo: process.env.CLIDE_HISTORY_PERF_STRICT === '1' ? false : 'history plan phases 6–7',
}, async () => {
  const { clientHistory } = await import('../../../../scripts/chat-history/fixtures');
  const messages = clientHistory(200);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const slot = { hasMore: false, status: 'idle' };
  let requests = 0;
  const store = {
    getMessages: () => messages, getSessionSlot: () => slot, setActiveSession: () => undefined,
    isStale: () => false, fetchSessionSettings: () => undefined,
    fetchFromServer: async () => { requests++; return slot; },
  } as unknown as SessionStore;
  const args: Parameters<typeof useChatSessionState>[0] = {
    selectedProject: { projectId: 'p', displayName: 'fixture', fullPath: '/tmp', path: '/tmp' },
    selectedSession: { id: 'fixture-client', __provider: 'claude' },
    ws: null, sendMessage: () => true, resetStreamingState: () => undefined,
    statusCheckSentAtRef: { current: new Map() }, getReplayProgress: () => null, sessionStore: store,
  };
  let state!: ReturnType<typeof useChatSessionState>;
  let find!: ChatFindController;
  function Harness() {
    state = useChatSessionState(args);
    find = useChatFind({ isVisible: true, sessionId: 'fixture-client', chatMessages: state.chatMessages,
      loadAllMessages: state.loadAllMessages, scrollContainerRef: state.scrollContainerRef,
      messagesContentRef: state.messagesContentRef });
    return React.createElement('div', { ref: state.scrollContainerRef },
      React.createElement('div', { ref: state.messagesContentRef }, state.visibleMessages.map((message) =>
        React.createElement('div', { key: message.id, className: 'chat-message', 'data-chat-find-scope': 'conversation' },
          React.createElement('div', { 'data-chat-find-content': true }, message.content)))));
  }
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(state.visibleMessages.length, 100);
    await React.act(async () => { find.open(); find.setQuery('Oldest unique needle'); });
    for (let i = 0; i < 3; i++) await React.act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    assert.equal(find.total, 1, 'target must remain reachable');
    assert.equal(requests, 0, 'complete cache must not be fetched again');
    assert.ok(state.visibleMessages.length <= historyBudgets.findMountedRows, `Find rendered ${state.visibleMessages.length} rows`);
  } finally {
    await React.act(async () => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
  }
});


test('display reuse follows tool-result, subagent and streaming changes without touching other rows', async () => {
  const { clientHistory } = await import('../../../../scripts/chat-history/fixtures');
  const plain = clientHistory(1)[0];
  const tool: NormalizedMessage = { ...plain, id: 'tool', kind: 'tool_use', toolId: 'call', toolName: 'Bash', toolInput: { command: 'echo x' } };
  const result: NormalizedMessage = { ...plain, id: 'result', kind: 'tool_result', toolId: 'call', content: 'before' };
  const first = normalizedToChatMessages([plain, tool]);
  const attached = normalizedToChatMessages([plain, tool, result]);
  assert.equal(first[0], attached[0]);
  assert.notEqual(first[1], attached[1]);
  assert.equal(attached[1].toolResult?.content, 'before');
  const changed = normalizedToChatMessages([plain, tool, { ...result, content: 'after', isError: true }]);
  assert.equal(changed[0], first[0]);
  assert.equal(changed[1].toolResult?.content, 'after');
  assert.equal(changed[1].toolResult?.isError, true);
  assert.equal(normalizedToChatMessages([plain, tool])[1].toolResult, null);
  const agent: NormalizedMessage = { ...tool, id: 'agent', toolName: 'Agent', subagentTools: [{ toolId: 'child', toolName: 'Bash', timestamp: plain.timestamp }] };
  const before = normalizedToChatMessages([plain, agent]);
  const after = normalizedToChatMessages([plain, { ...agent, subagentTools: [...agent.subagentTools!, { toolId: 'child2', toolName: 'Read', timestamp: plain.timestamp }] }]);
  assert.equal(before[0], after[0]);
  assert.equal(after[1].subagentState?.childTools.length, 2);
  const streaming: NormalizedMessage = { ...plain, id: 'stream', kind: 'stream_delta', role: 'assistant', content: 'first' };
  const streamed = normalizedToChatMessages([plain, streaming]);
  const delta = normalizedToChatMessages([plain, { ...streaming, content: 'first second' }]);
  assert.equal(streamed[0], delta[0]);
  assert.equal(delta[1].content, 'first second');
});
