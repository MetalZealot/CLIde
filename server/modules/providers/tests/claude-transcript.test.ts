import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import {
  ClaudeSessionsProvider,
  collectCompactReferencesByRowId,
  dropDuplicateLocalCommandEchoes,
  readClaudeCompactBoundary,
} from '@/modules/providers/list/claude/claude-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';

import {
  computeResumeAnchor,
  encodeClaudeProjectDir,
  extractBaseTranscriptUuid,
  filterToActiveBranch,
  type RewindTranscriptEntry,
} from '../list/claude/claude-rewind.util.js';
import { codexAppServerRuntimeCapabilitiesAvailable } from '../list/codex/codex-chat-transport-state.js';
import { providerCapabilitiesService } from '../services/provider-capabilities.service.js';

describe('claude-compaction-rows', () => {
  const SESSION_ID = 'session-1';

  function userText(
    id: string,
    content: string,
    timestamp: string,
    extra: Partial<NormalizedMessage> = {},
  ): NormalizedMessage {
    return {
      id,
      sessionId: SESSION_ID,
      provider: 'claude',
      kind: 'text',
      role: 'user',
      content,
      timestamp,
      ...extra,
    } as NormalizedMessage;
  }

  // `/compact` is the one local command Claude writes twice — a real prompt row
  // plus the `<command-name>` wrapper ~50ms later — which rendered as two
  // identical bubbles, only the first of which could be rewound to.
  test('claude compaction: the /compact wrapper echo is dropped, the prompt row survives', () => {
    const messages = [
      userText('564e997e', '/compact', '2026-07-30T13:57:04.307Z'),
      userText('44522c87', '/compact', '2026-07-30T13:57:04.357Z', { isLocalCommand: true }),
    ];

    const kept = dropDuplicateLocalCommandEchoes(messages);

    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, '564e997e');
    assert.equal(kept[0].isLocalCommand, undefined);
  });

  // Every other local command writes only the wrapper, which is the whole reason
  // wrappers are rendered — dropping those would erase the command from history.
  test('claude compaction: a lone local-command wrapper is preserved', () => {
    const messages = [
      userText('m1', 'earlier turn', '2026-07-30T13:50:00.000Z'),
      userText('m2', '/model', '2026-07-30T13:57:04.357Z', { isLocalCommand: true }),
    ];

    assert.equal(dropDuplicateLocalCommandEchoes(messages).length, 2);
  });

  // A repeat of the same command much later is a genuine second invocation.
  test('claude compaction: an identical prompt outside the echo window is not treated as a duplicate', () => {
    const messages = [
      userText('m1', '/compact', '2026-07-30T12:00:00.000Z'),
      userText('m2', '/compact', '2026-07-30T13:57:04.357Z', { isLocalCommand: true }),
    ];

    assert.equal(dropDuplicateLocalCommandEchoes(messages).length, 2);
  });

  test('claude compaction: compact file references are collected onto the summary row', () => {
    const rawMessages = [
      { uuid: 'summary', isCompactSummary: true, message: { role: 'user', content: 'Summary...' } },
      { type: 'attachment', attachment: { type: 'file', displayPath: 'server/a.ts' } },
      { type: 'attachment', attachment: { type: 'compact_file_reference', displayPath: 'server/b.ts' } },
      // Bookkeeping between the summary and the attachments must not end the run.
      { message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } },
      { type: 'attachment', attachment: { type: 'compact_file_reference', displayPath: 'TODO.md' } },
      // Non-file attachments ride along in the same run and are ignored.
      { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['Monitor'] } },
      // The next real turn ends the run.
      { message: { role: 'user', content: 'what next?' } },
      { type: 'attachment', attachment: { type: 'file', displayPath: 'not-part-of-compaction.ts' } },
    ];

    const references = collectCompactReferencesByRowId(rawMessages);

    assert.deepEqual(references.get('summary'), ['server/a.ts', 'server/b.ts', 'TODO.md']);
  });

  test('claude compaction: a summary with no file attachments yields no references entry', () => {
    const rawMessages = [
      { uuid: 'summary', isCompactSummary: true, message: { role: 'user', content: 'Summary...' } },
      { message: { role: 'assistant', content: 'next reply' } },
      { type: 'attachment', attachment: { type: 'file', displayPath: 'later.ts' } },
    ];

    assert.equal(collectCompactReferencesByRowId(rawMessages).has('summary'), false);
  });

  // The same boundary reaches us twice with two spellings: the live SDK stream
  // sends snake_case, the transcript on disk stores camelCase. Both must produce
  // the divider, or a reloaded session loses a marker it showed live.
  test('claude compaction: a boundary row is read in both the live and transcript spellings', () => {
    const live = readClaudeCompactBoundary({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 122537, post_tokens: 15517, duration_ms: 119489 },
    });
    const stored = readClaudeCompactBoundary({
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto', preTokens: 122537, postTokens: 15517, durationMs: 119489 },
    });

    assert.deepEqual(live, { trigger: 'auto', preTokens: 122537, postTokens: 15517, durationMs: 119489 });
    assert.deepEqual(stored, live);
  });

  test('claude compaction: a partial boundary keeps its trigger and nulls what is missing', () => {
    assert.deepEqual(
      readClaudeCompactBoundary({
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'manual', preTokens: 90_000 },
      }),
      { trigger: 'manual', preTokens: 90_000, postTokens: null, durationMs: null },
    );
  });

  test('claude compaction: non-boundary system rows are not mistaken for one', () => {
    assert.equal(readClaudeCompactBoundary({ type: 'system', subtype: 'status', status: 'compacting' }), null);
    assert.equal(readClaudeCompactBoundary({ type: 'system', subtype: 'compact_boundary' }), null);
    assert.equal(readClaudeCompactBoundary({ message: { role: 'user', content: '/compact' } }), null);
  });
});

describe('claude-harness-rows', () => {
  const SESSION_ID = 'session-1';

  // Regression guard for commit 9e85c23: the harness-row filter must not swallow
  // compact summaries. Claude stores them as transcript-only / synthetic "user"
  // rows (isVisibleInTranscriptOnly in JSONL, isSynthetic in the live stream), so
  // the isHiddenUserRow guard has to exempt isCompactSummary or the summary
  // vanishes from chat entirely.

  test('claude history: transcript compact summary surfaces as an assistant summary', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'cs1',
      timestamp: '2026-07-23T10:00:00.000Z',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { role: 'user', content: 'This session is being continued from a previous conversation...' },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].isCompactSummary, true);
    assert.equal(messages[0].content, 'This session is being continued from a previous conversation...');
  });

  test('claude live stream: synthetic compact summary still surfaces', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'cs2',
      timestamp: '2026-07-23T10:00:00.000Z',
      isCompactSummary: true,
      isSynthetic: true,
      message: { role: 'user', content: 'Summary of the earlier turns.' },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].isCompactSummary, true);
  });

  test('claude history: isMeta and transcript-only user rows are filtered', () => {
    const provider = new ClaudeSessionsProvider();

    const metaRow = provider.normalizeMessage(
      { uuid: 'm1', message: { role: 'user', content: 'injected skill content' }, isMeta: true },
      SESSION_ID,
    );
    assert.equal(metaRow.length, 0);

    const transcriptOnlyRow = provider.normalizeMessage(
      { uuid: 'm2', message: { role: 'user', content: 'transcript-only noise' }, isVisibleInTranscriptOnly: true },
      SESSION_ID,
    );
    assert.equal(transcriptOnlyRow.length, 0);
  });

  test('claude history: synthetic assistant notice is flagged isSystemNotice', () => {
    const provider = new ClaudeSessionsProvider();
    const entry = {
      uuid: 'n1',
      timestamp: '2026-07-23T10:00:00.000Z',
      message: { role: 'assistant', model: '<synthetic>', content: 'Claude usage limit reached.' },
    };

    const messages = provider.normalizeMessage(entry, SESSION_ID);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].isSystemNotice, true);
  });

  // A synthetic "No response requested." row (written on a usage-limit cutoff or
  // /compact) carries no information; it is dropped entirely rather than shown as
  // a banner. Covers both the string and array content shapes.
  test('claude: synthetic "No response requested." rows are dropped', () => {
    const provider = new ClaudeSessionsProvider();

    const stringRow = provider.normalizeMessage(
      {
        uuid: 'nr1',
        timestamp: '2026-07-23T10:00:00.000Z',
        message: { role: 'assistant', model: '<synthetic>', content: 'No response requested.' },
      },
      SESSION_ID,
    );
    assert.equal(stringRow.length, 0);

    const arrayRow = provider.normalizeMessage(
      {
        uuid: 'nr2',
        timestamp: '2026-07-23T10:00:00.000Z',
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'No response requested.' }],
        },
      },
      SESSION_ID,
    );
    assert.equal(arrayRow.length, 0);
  });

  // A genuine model message with the same words must NOT be swallowed — the drop
  // is gated on the synthetic flag, not the text alone.
  test('claude: a real assistant message saying "No response requested." survives', () => {
    const provider = new ClaudeSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        uuid: 'nr3',
        timestamp: '2026-07-23T10:00:00.000Z',
        message: { role: 'assistant', model: 'claude-opus-4-8', content: 'No response requested.' },
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'No response requested.');
    assert.equal(messages[0].isSystemNotice, undefined);
  });

  // A `system` row holds its payload at the top level, so the user-row tag
  // handling never sees it. A turn that forks its work into a background agent
  // writes no Task tool call at all — this notice is its only trace.
  test('claude history: a system row\'s local-command stdout surfaces as assistant text', () => {
    const provider = new ClaudeSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        uuid: 'sys1',
        timestamp: '2026-08-27T21:30:36.856Z',
        type: 'system',
        subtype: 'local_command',
        content:
          '<local-command-stdout>Running in the background as @code-review</local-command-stdout>\n'
          + '<forked-skill-launch>{"agentId":"a294e020","skillName":"code-review"}</forked-skill-launch>',
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].isLocalCommandStdout, true);
    assert.equal(messages[0].content, 'Running in the background as @code-review');
  });

  test('claude history: a system row\'s local-command stderr surfaces as an error', () => {
    const provider = new ClaudeSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        uuid: 'sys2',
        timestamp: '2026-08-27T21:30:36.856Z',
        type: 'system',
        subtype: 'local_command',
        content: '<local-command-stderr>Error during compaction: session limit</local-command-stderr>',
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'error');
    assert.equal(messages[0].content, 'Error during compaction: session limit');
  });

  // The command itself already has a visible user row; echoing it from the
  // system row would double it in chat.
  test('claude history: a system command-name row stays silent', () => {
    const provider = new ClaudeSessionsProvider();
    const messages = provider.normalizeMessage(
      {
        uuid: 'sys3',
        timestamp: '2026-08-27T21:30:36.856Z',
        type: 'system',
        subtype: 'local_command',
        content: '<command-name>/context</command-name>\n<command-args></command-args>',
      },
      SESSION_ID,
    );

    assert.equal(messages.length, 0);
  });
});

describe('claude-rewind', () => {
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  /**
   * Mirrors the observed transcript tree after one rewind (probe 2026-07-22):
   * user ONE -> attachment -> asst ONE, user TWO -> asst TWO (abandoned),
   * user FOUR (parent = asst ONE) -> asst FOUR.
   */
  function rewoundTranscript(): RewindTranscriptEntry[] {
    return [
      { uuid: U(1), parentUuid: null, type: 'user' },
      { uuid: U(2), parentUuid: U(1), type: 'attachment' },
      { uuid: U(3), parentUuid: U(2), type: 'assistant' },
      { type: 'last-prompt' },
      { uuid: U(4), parentUuid: U(3), type: 'user' },
      { uuid: U(5), parentUuid: U(4), type: 'attachment' },
      { uuid: U(6), parentUuid: U(5), type: 'assistant' },
      { uuid: U(7), parentUuid: U(3), type: 'user' },
      { uuid: U(8), parentUuid: U(7), type: 'attachment' },
      { uuid: U(9), parentUuid: U(8), type: 'assistant' },
    ];
  }

  describe('extractBaseTranscriptUuid', () => {
    it('returns the id itself for a bare transcript uuid', () => {
      assert.equal(extractBaseTranscriptUuid(U(1)), U(1));
    });

    it('strips part suffixes (_text_N, _tr_<id>, _images, _N)', () => {
      assert.equal(extractBaseTranscriptUuid(`${U(1)}_text_2`), U(1));
      assert.equal(extractBaseTranscriptUuid(`${U(1)}_tr_toolu_abc`), U(1));
      assert.equal(extractBaseTranscriptUuid(`${U(1)}_images`), U(1));
      assert.equal(extractBaseTranscriptUuid(`${U(1)}_0`), U(1));
    });

    it('rejects generateMessageId fallbacks and non-uuid ids', () => {
      assert.equal(extractBaseTranscriptUuid(`claude_${U(1)}`), null);
      assert.equal(extractBaseTranscriptUuid('msg_12345'), null);
      assert.equal(extractBaseTranscriptUuid(undefined), null);
      assert.equal(extractBaseTranscriptUuid(42), null);
    });
  });

  describe('computeResumeAnchor', () => {
    it('walks the parent chain through metadata rows to the nearest assistant', () => {
      // user TWO's chain: attachment U(2)? no — parent is asst U(3) directly in
      // the probe; here user U(4)'s parent IS the assistant U(3).
      assert.deepEqual(computeResumeAnchor(rewoundTranscript(), U(4)), {
        found: true,
        anchorUuid: U(3),
      });
    });

    it('walks through non-assistant chain links', () => {
      const entries: RewindTranscriptEntry[] = [
        { uuid: U(1), parentUuid: null, type: 'user' },
        { uuid: U(2), parentUuid: U(1), type: 'attachment' },
        { uuid: U(3), parentUuid: U(2), type: 'assistant' },
        { uuid: U(4), parentUuid: U(3), type: 'attachment' },
        { uuid: U(5), parentUuid: U(4), type: 'user' },
      ];
      assert.deepEqual(computeResumeAnchor(entries, U(5)), { found: true, anchorUuid: U(3) });
    });

    it('returns anchorUuid null for the first user message (fresh-session case)', () => {
      assert.deepEqual(computeResumeAnchor(rewoundTranscript(), U(1)), {
        found: true,
        anchorUuid: null,
      });
    });

    it('reports found: false for an unknown uuid', () => {
      assert.deepEqual(computeResumeAnchor(rewoundTranscript(), U(99)), {
        found: false,
        anchorUuid: null,
      });
    });

    it('is case-insensitive on uuids', () => {
      assert.deepEqual(computeResumeAnchor(rewoundTranscript(), U(4).toUpperCase()), {
        found: true,
        anchorUuid: U(3),
      });
    });
  });

  describe('filterToActiveBranch', () => {
    it('drops the abandoned branch after a rewind, keeps the active one', () => {
      const filtered = filterToActiveBranch(rewoundTranscript());
      const uuids = filtered.map((e) => e.uuid);
      // abandoned user/assistant (U4/U6) gone; active chain + metadata kept
      assert.ok(!uuids.includes(U(4)));
      assert.ok(!uuids.includes(U(6)));
      assert.ok(uuids.includes(U(1)));
      assert.ok(uuids.includes(U(3)));
      assert.ok(uuids.includes(U(7)));
      assert.ok(uuids.includes(U(9)));
      // abandoned attachment row (metadata) deliberately untouched
      assert.ok(uuids.includes(U(5)));
    });

    it('keeps a linear transcript intact', () => {
      const entries: RewindTranscriptEntry[] = [
        { uuid: U(1), parentUuid: null, type: 'user' },
        { uuid: U(2), parentUuid: U(1), type: 'assistant' },
        { uuid: U(3), parentUuid: U(2), type: 'user' },
        { uuid: U(4), parentUuid: U(3), type: 'assistant' },
        { type: 'last-prompt' },
      ];
      assert.deepEqual(filterToActiveBranch(entries), entries);
    });

    it('keeps chain segments disconnected from the active root (compaction)', () => {
      const entries: RewindTranscriptEntry[] = [
        // pre-compaction segment, own root
        { uuid: U(1), parentUuid: null, type: 'user' },
        { uuid: U(2), parentUuid: U(1), type: 'assistant' },
        // post-compaction restart, new null root = active chain
        { uuid: U(3), parentUuid: null, type: 'user' },
        { uuid: U(4), parentUuid: U(3), type: 'assistant' },
      ];
      assert.deepEqual(filterToActiveBranch(entries), entries);
    });

    it('keeps sidechain and uuid-less entries unconditionally', () => {
      const entries: RewindTranscriptEntry[] = [
        { uuid: U(1), parentUuid: null, type: 'user' },
        { uuid: U(2), parentUuid: U(1), type: 'assistant' },
        { uuid: U(10), parentUuid: null, type: 'user', isSidechain: true },
        { type: 'queue-operation' },
        { uuid: U(3), parentUuid: U(2), type: 'user' },
        { uuid: U(4), parentUuid: U(3), type: 'assistant' },
      ];
      assert.deepEqual(filterToActiveBranch(entries), entries);
    });

    it('handles stacked rewinds (branch off an abandoned branch stays hidden)', () => {
      const entries: RewindTranscriptEntry[] = [
        { uuid: U(1), parentUuid: null, type: 'user' },
        { uuid: U(2), parentUuid: U(1), type: 'assistant' },
        // first abandoned branch
        { uuid: U(3), parentUuid: U(2), type: 'user' },
        { uuid: U(4), parentUuid: U(3), type: 'assistant' },
        // second branch, forked off the first abandoned one
        { uuid: U(5), parentUuid: U(4), type: 'user' },
        { uuid: U(6), parentUuid: U(5), type: 'assistant' },
        // active branch: rewound back to U(2)
        { uuid: U(7), parentUuid: U(2), type: 'user' },
        { uuid: U(8), parentUuid: U(7), type: 'assistant' },
      ];
      const uuids = filterToActiveBranch(entries).map((e) => e.uuid);
      assert.deepEqual(uuids, [U(1), U(2), U(7), U(8)]);
    });

    it('returns entries unchanged when there is no user/assistant tip', () => {
      const entries: RewindTranscriptEntry[] = [{ type: 'summary' }, { type: 'ai-title' }];
      assert.deepEqual(filterToActiveBranch(entries), entries);
    });
  });

  describe('supportsRewind capability', () => {
    it('is enabled for claude, and for codex only on the App Server transport', () => {
      assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').supportsRewind, true);
      // Codex gained rewind with the App Server transport (see
      // withRuntimeCapabilities in provider-capabilities.service.ts); it stays off
      // whenever that transport is not the one actually running.
      assert.equal(
        providerCapabilitiesService.getProviderCapabilities('codex').supportsRewind,
        codexAppServerRuntimeCapabilitiesAvailable(),
      );
      for (const provider of ['cursor', 'opencode'] as const) {
        assert.equal(
          providerCapabilitiesService.getProviderCapabilities(provider).supportsRewind,
          false,
          provider,
        );
      }
    });
  });

  describe('encodeClaudeProjectDir', () => {
    it('replaces non-alphanumerics, and truncates with a hash past 200 characters', () => {
      assert.equal(
        encodeClaudeProjectDir('/home/user/Projects/cloudcli'),
        '-home-user-Projects-cloudcli',
      );

      // Golden case: runtime 2.1.233 wrote exactly this directory for this cwd.
      const deep = `/tmp/clide-encoder-probe/${Array.from({ length: 40 }, (_, i) => `seg${String(i).padStart(2, '0')}`).join('/')}`;
      const encoded = encodeClaudeProjectDir(deep);
      assert.equal(encoded.length, 207);
      assert.equal(encoded.slice(200), '-rpzdak');
      assert.ok(encoded.startsWith('-tmp-clide-encoder-probe-seg00-'));
    });
  });
});
