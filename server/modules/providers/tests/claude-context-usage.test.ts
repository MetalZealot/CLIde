import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureClaudeContextUsage,
  clearClaudeContextCeilings,
  getClaudeContextCeiling,
  parseClaudeContextUsage,
  rememberClaudeContextCeiling,
} from '@/modules/providers/list/claude/claude-context-usage.js';

// Trimmed from a real getContextUsage() response — see the FINDINGS block in
// scripts/verify-context-usage-sdk.ts (claude-sonnet-5, SDK 0.3.220).
const SONNET_PAYLOAD = {
  totalTokens: 26878,
  maxTokens: 967000,
  rawMaxTokens: 967000,
  percentage: 3,
  model: 'claude-sonnet-5',
  autoCompactThreshold: 934000,
  isAutoCompactEnabled: true,
  categories: [{ name: 'System prompt', tokens: 8835, color: 'blue' }],
};

test('parses the fields the ring needs off a real payload', () => {
  const parsed = parseClaudeContextUsage(SONNET_PAYLOAD);
  assert.ok(parsed);
  assert.equal(parsed.maxTokens, 967_000);
  assert.equal(parsed.autoCompactThreshold, 934_000);
  assert.equal(parsed.isAutoCompactEnabled, true);
  assert.equal(parsed.model, 'claude-sonnet-5');
  assert.equal(parsed.totalTokens, 26_878);
  assert.ok(parsed.fetchedAt > 0);
});

test('falls back to rawMaxTokens when maxTokens is missing', () => {
  const parsed = parseClaudeContextUsage({ rawMaxTokens: 200000, isAutoCompactEnabled: false });
  assert.equal(parsed?.maxTokens, 200_000);
  assert.equal(parsed?.isAutoCompactEnabled, false);
  assert.equal(parsed?.autoCompactThreshold, undefined);
});

test('rejects payloads with no usable ceiling', () => {
  // A zero denominator would blank the ring, so these must degrade to the
  // derived fallback rather than being cached.
  assert.equal(parseClaudeContextUsage(null), null);
  assert.equal(parseClaudeContextUsage('nope'), null);
  assert.equal(parseClaudeContextUsage({}), null);
  assert.equal(parseClaudeContextUsage({ maxTokens: 0 }), null);
  assert.equal(parseClaudeContextUsage({ maxTokens: -5 }), null);
  assert.equal(parseClaudeContextUsage({ maxTokens: 'lots' }), null);
});

test('remembers a ceiling per session and ignores a missing session id', () => {
  clearClaudeContextCeilings();
  const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

  rememberClaudeContextCeiling('session-a', ceiling);
  rememberClaudeContextCeiling(null, ceiling);
  rememberClaudeContextCeiling(undefined, ceiling);

  assert.equal(getClaudeContextCeiling('session-a')?.maxTokens, 967_000);
  assert.equal(getClaudeContextCeiling('session-b'), null);
  assert.equal(getClaudeContextCeiling(null), null);
});

test('evicts the least recently written session past the cap', () => {
  clearClaudeContextCeilings();
  const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

  // 200 is the cap; writing 250 must not grow without bound.
  for (let i = 0; i < 250; i += 1) {
    rememberClaudeContextCeiling(`session-${i}`, ceiling);
  }

  assert.equal(getClaudeContextCeiling('session-0'), null);
  assert.equal(getClaudeContextCeiling('session-49'), null);
  assert.ok(getClaudeContextCeiling('session-50'));
  assert.ok(getClaudeContextCeiling('session-249'));
});

test('re-writing a session keeps it from being evicted as stale', () => {
  clearClaudeContextCeilings();
  const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

  rememberClaudeContextCeiling('long-lived', ceiling);
  for (let i = 0; i < 150; i += 1) {
    rememberClaudeContextCeiling(`filler-${i}`, ceiling);
  }
  rememberClaudeContextCeiling('long-lived', ceiling);
  for (let i = 150; i < 300; i += 1) {
    rememberClaudeContextCeiling(`filler-${i}`, ceiling);
  }

  assert.ok(getClaudeContextCeiling('long-lived'));
});

test('captures a live reading into the cache', async () => {
  clearClaudeContextCeilings();
  const captured = await captureClaudeContextUsage('session-live', {
    getContextUsage: async () => SONNET_PAYLOAD,
  });

  assert.equal(captured?.maxTokens, 967_000);
  assert.equal(getClaudeContextCeiling('session-live')?.autoCompactThreshold, 934_000);
});

test('a failing control request is not an error for the ring', async () => {
  clearClaudeContextCeilings();

  // The two failures the probe actually hit, plus a CLI too old to answer.
  const closed = await captureClaudeContextUsage('session-closed', {
    getContextUsage: async () => {
      throw new Error('Query closed before response received');
    },
  });
  const notWritable = await captureClaudeContextUsage('session-dead', {
    getContextUsage: async () => {
      throw new Error('ProcessTransport is not ready for writing');
    },
  });
  const unsupported = await captureClaudeContextUsage('session-old', {});
  const noSession = await captureClaudeContextUsage(null, {
    getContextUsage: async () => SONNET_PAYLOAD,
  });

  assert.equal(closed, null);
  assert.equal(notWritable, null);
  assert.equal(unsupported, null);
  assert.equal(noSession, null);
  assert.equal(getClaudeContextCeiling('session-closed'), null);
  assert.equal(getClaudeContextCeiling('session-dead'), null);
});

test('a malformed live reading leaves the cache alone', async () => {
  clearClaudeContextCeilings();
  rememberClaudeContextCeiling('session-x', parseClaudeContextUsage(SONNET_PAYLOAD)!);

  const captured = await captureClaudeContextUsage('session-x', {
    getContextUsage: async () => ({ maxTokens: 'unknown' }),
  });

  assert.equal(captured, null);
  // The previous good reading survives rather than being replaced by junk.
  assert.equal(getClaudeContextCeiling('session-x')?.maxTokens, 967_000);
});
