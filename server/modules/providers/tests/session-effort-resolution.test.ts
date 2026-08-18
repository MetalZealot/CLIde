import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readClaudeSessionEffortFromJsonl } from '@/modules/providers/list/claude/claude-session-effort.js';
import { readCodexSessionEffortFromRollout } from '@/modules/providers/list/codex/codex-session-effort.js';
import {
  getProviderSessionEffort,
  resolveSessionEffort,
} from '@/modules/providers/index.js';
import type { SessionEffortPickStore } from '@/modules/providers/index.js';

const EARLIER = '2026-08-17T10:00:00.000Z';
const LATER = '2026-08-17T11:00:00.000Z';

const resolveClaude = (
  pick: { effort: string | null; updatedAt?: string } | null,
  evidence: { effort: string; timestamp?: string } | null,
  providerDefault?: string | null,
) => resolveSessionEffort({
  provider: 'claude',
  sessionId: 'session-1',
  supported: true,
  pick,
  evidence,
  providerDefault,
});

test('a pick at least as recent as the last turn still describes the session', () => {
  const resolved = resolveClaude(
    { effort: 'medium', updatedAt: LATER },
    { effort: 'high', timestamp: EARLIER },
  );

  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.source, 'pick');
  // Both inputs stay visible: the request won, but the last turn really did run
  // at "high", and a caller that needs to say so can.
  assert.equal(resolved.requested, 'medium');
  assert.equal(resolved.effective, 'high');
});

test('a newer turn supersedes an older pick', () => {
  const resolved = resolveClaude(
    { effort: 'medium', updatedAt: EARLIER },
    { effort: 'high', timestamp: LATER },
  );

  // The effort changed by a path the app never saw — a Shell /model, fast mode
  // — and the transcript is the record of what actually ran (ADR 0003).
  assert.equal(resolved.effort, 'high');
  assert.equal(resolved.source, 'transcript');
});

test('a pick that lost its timestamp defers to turn evidence', () => {
  const resolved = resolveClaude(
    { effort: 'medium' },
    { effort: 'high', timestamp: EARLIER },
  );

  assert.equal(resolved.effort, 'high');
  assert.equal(resolved.source, 'transcript');
});

test('a pick with no turn to argue against stands', () => {
  const resolved = resolveClaude({ effort: 'medium', updatedAt: EARLIER }, null);

  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.source, 'pick');
  assert.equal(resolved.effective, null);
});

test('turn evidence alone resolves the session', () => {
  const resolved = resolveClaude(null, { effort: 'xhigh', timestamp: LATER });

  assert.equal(resolved.effort, 'xhigh');
  assert.equal(resolved.source, 'transcript');
  assert.equal(resolved.requested, null);
});

test('with nothing chosen and nothing recorded the provider default applies', () => {
  const resolved = resolveClaude(null, null, 'medium');

  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.source, 'default');
});

test('an unknown default resolves to no effort rather than a guess', () => {
  const resolved = resolveClaude(null, null);

  assert.equal(resolved.effort, null);
  assert.equal(resolved.source, 'none');
});

test('an unsupported provider resolves to nothing at all', () => {
  const resolved = resolveSessionEffort({
    provider: 'cursor',
    sessionId: 'session-1',
    supported: false,
    pick: { effort: 'high', updatedAt: LATER },
    evidence: { effort: 'high', timestamp: LATER },
    providerDefault: 'medium',
  });

  assert.equal(resolved.supported, false);
  assert.equal(resolved.effort, null);
  assert.equal(resolved.requested, null);
  assert.equal(resolved.effective, null);
  assert.equal(resolved.source, 'none');
});

const stubStore = (pick: { effort: string; updatedAt: string | null } | null): SessionEffortPickStore => ({
  getSessionEffortPick: () => pick,
  setSessionEffortPick: () => true,
});

test('an adapter with no turn evidence reports the request without inventing effective state', async () => {
  // OpenCode accepts effort but records nothing about what a turn ran at.
  // Echoing the request back as `effective` would be a fabricated confirmation
  // that then outranks real evidence anywhere the two are compared.
  const resolved = await getProviderSessionEffort('opencode', 'session-1', {
    store: stubStore({ effort: 'high', updatedAt: EARLIER }),
    getSessionRow: () => ({ jsonl_path: '/does/not/matter.jsonl' }),
  });

  assert.equal(resolved.supported, true);
  assert.equal(resolved.requested, 'high');
  assert.equal(resolved.effective, null);
  assert.equal(resolved.effort, 'high');
  assert.equal(resolved.source, 'pick');
});

test('an adapter with no turn evidence and no pick falls back to the provider default', async () => {
  const resolved = await getProviderSessionEffort('opencode', 'session-1', {
    store: stubStore(null),
    providerDefault: 'medium',
  });

  assert.equal(resolved.effective, null);
  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.source, 'default');
});

test('an unsupported provider short-circuits before reading anything', async () => {
  let storeWasRead = false;
  const resolved = await getProviderSessionEffort('cursor', 'session-1', {
    store: {
      getSessionEffortPick: () => {
        storeWasRead = true;
        return { effort: 'high', updatedAt: EARLIER };
      },
      setSessionEffortPick: () => true,
    },
  });

  assert.equal(resolved.supported, false);
  assert.equal(resolved.effort, null);
  assert.equal(storeWasRead, false, 'an unsupported provider should not read storage');
});

async function withTranscript(
  name: string,
  lines: unknown[],
  runTest: (transcriptPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'session-effort-transcript-'));
  const transcriptPath = path.join(directory, name);
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

  try {
    await runTest(transcriptPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Claude's transcript reports the effort of the last real turn", async () => {
  await withTranscript('claude.jsonl', [
    { type: 'assistant', sessionId: 'provider-1', effort: 'low', timestamp: EARLIER },
    { type: 'assistant', sessionId: 'provider-1', effort: 'high', timestamp: LATER },
    // A subagent turn runs at its own effort and says nothing about the
    // conversation the user is looking at.
    { type: 'assistant', sessionId: 'provider-1', effort: 'max', isSidechain: true, timestamp: LATER },
    // A superseded provider session's entries can survive a rewind in the same
    // file; they belong to a different conversation.
    { type: 'assistant', sessionId: 'provider-old', effort: 'medium', timestamp: LATER },
    { type: 'assistant', sessionId: 'provider-1', timestamp: LATER },
  ], async (transcriptPath) => {
    const evidence = await readClaudeSessionEffortFromJsonl('provider-1', transcriptPath);
    assert.deepEqual(evidence, { effort: 'high', timestamp: LATER });
  });
});

test('a Claude transcript with no effort stamped reports none', async () => {
  await withTranscript('claude-bare.jsonl', [
    { type: 'assistant', sessionId: 'provider-1', timestamp: EARLIER },
    'not json at all',
  ], async (transcriptPath) => {
    assert.equal(await readClaudeSessionEffortFromJsonl('provider-1', transcriptPath), null);
  });
});

test("Codex's rollout reports the effort of the newest turn_context", async () => {
  await withTranscript('rollout.jsonl', [
    { type: 'turn_context', timestamp: EARLIER, payload: { turn_id: 'a', effort: 'low' } },
    { type: 'turn_context', timestamp: LATER, payload: { turn_id: 'b', effort: 'high' } },
    { type: 'event_msg', timestamp: LATER, payload: { type: 'token_count' } },
  ], async (transcriptPath) => {
    const evidence = await readCodexSessionEffortFromRollout(transcriptPath);
    assert.deepEqual(evidence, { effort: 'high', timestamp: LATER });
  });
});

test("Codex's collaboration-mode settings are read when the top-level effort is absent", async () => {
  await withTranscript('rollout-legacy.jsonl', [
    {
      type: 'turn_context',
      timestamp: LATER,
      payload: {
        turn_id: 'a',
        collaboration_mode: { mode: 'default', settings: { reasoning_effort: 'xhigh' } },
      },
    },
  ], async (transcriptPath) => {
    const evidence = await readCodexSessionEffortFromRollout(transcriptPath);
    assert.deepEqual(evidence, { effort: 'xhigh', timestamp: LATER });
  });
});

test('a session resolves against its own transcript, keyed by the provider-native id', async () => {
  await withTranscript('claude-live.jsonl', [
    { type: 'assistant', sessionId: 'provider-1', effort: 'high', timestamp: LATER },
  ], async (transcriptPath) => {
    const superseded = await getProviderSessionEffort('claude', 'app-1', {
      store: stubStore({ effort: 'medium', updatedAt: EARLIER }),
      getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: transcriptPath }),
    });
    assert.equal(superseded.effort, 'high');
    assert.equal(superseded.source, 'transcript');

    const picked = await getProviderSessionEffort('claude', 'app-1', {
      store: stubStore({ effort: 'medium', updatedAt: LATER }),
      getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: transcriptPath }),
    });
    assert.equal(picked.effort, 'medium');
    assert.equal(picked.source, 'pick');
  });
});

test('an unreadable transcript degrades to the stored request instead of failing', async () => {
  const resolved = await getProviderSessionEffort('claude', 'app-1', {
    store: stubStore({ effort: 'medium', updatedAt: EARLIER }),
    getSessionRow: () => ({ provider_session_id: 'provider-1', jsonl_path: '/nonexistent/transcript.jsonl' }),
  });

  assert.equal(resolved.effective, null);
  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.source, 'pick');
});
