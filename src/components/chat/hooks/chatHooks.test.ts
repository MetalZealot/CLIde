// Pure helpers exported by the chat hooks: composer popover routing, send-time
// model/effort selection, effort/model compatibility, and realtime
// permission-request de-duplication.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { PendingPermissionRequest } from '../types/types';
import { formatPlaybackTime, VoicePlayer, voiceId } from '../../../lib/voicePlayer';

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
import { normalizeVoiceTranscript } from './useVoiceInput';

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
