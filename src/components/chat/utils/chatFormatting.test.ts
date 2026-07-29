import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizedToChatMessages } from '../hooks/useChatMessages';

import { stripInternalMemoryCitation } from './chatFormatting';

const citation = `<oai-mem-citation>
<citation_entries>
MEMORY.md:48-69|note=[used provider guidance]
</citation_entries>
<rollout_ids>
019fa084-2786-7a32-8a93-ff1b3f8efae0
</rollout_ids>
</oai-mem-citation>`;

test('strips a complete internal memory citation from the end of an assistant reply', () => {
  assert.equal(
    stripInternalMemoryCitation(`The requested change is complete.\n\n${citation}\n`),
    'The requested change is complete.',
  );
});

test('strips an internal-only memory citation so no empty bubble content remains', () => {
  assert.equal(stripInternalMemoryCitation(citation), '');
});

test('preserves reserved citation markup when it is not the final block', () => {
  const content = `${citation}\n\nThis paragraph follows the example.`;
  assert.equal(stripInternalMemoryCitation(content), content);
});

test('preserves incomplete or similarly named XML-like content', () => {
  const incomplete = 'Example:\n<oai-mem-citation><citation_entries>unfinished';
  const ordinary = '<memory-citation>keep this</memory-citation>';

  assert.equal(stripInternalMemoryCitation(incomplete), incomplete);
  assert.equal(stripInternalMemoryCitation(ordinary), ordinary);
});

test('assistant normalization hides the citation while user text remains untouched', () => {
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
  assert.equal(messages[1]?.content, citation);
});
