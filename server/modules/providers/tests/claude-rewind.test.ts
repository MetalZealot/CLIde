import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeResumeAnchor,
  extractBaseTranscriptUuid,
  filterToActiveBranch,
  type RewindTranscriptEntry,
} from '../list/claude/claude-rewind.util.js';
import { codexAppServerRuntimeCapabilitiesAvailable } from '../list/codex/codex-chat-transport-state.js';
import { providerCapabilitiesService } from '../services/provider-capabilities.service.js';

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
