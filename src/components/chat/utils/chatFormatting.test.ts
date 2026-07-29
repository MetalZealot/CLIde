import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizedToChatMessages } from '../hooks/useChatMessages';

import { extractInternalMemoryCitation, formatMemoryCitationSource } from './chatFormatting';

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

test('formats a cited line range compactly for display', () => {
  assert.equal(formatMemoryCitationSource('MEMORY.md:48-69'), 'MEMORY.md:48–69');
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
