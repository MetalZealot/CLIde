import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectCompactReferencesByRowId,
  dropDuplicateLocalCommandEchoes,
} from '@/modules/providers/list/claude/claude-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';

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
