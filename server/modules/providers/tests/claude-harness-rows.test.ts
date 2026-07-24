import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

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
