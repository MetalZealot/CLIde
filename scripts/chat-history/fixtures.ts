// Synthetic data shared by the history benchmark and regression fixtures.
export const HISTORY_FIXTURE_VERSION = 1;
export const HISTORY_SIZES = [200, 2_000, 10_000] as const;
export type HistoryProfile = 'plain' | 'mixed' | 'heavy' | 'bursts';
export type HistoryProvider = 'claude' | 'codex';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==';

export function fixtureText(index: number, rich = false): string {
  const text = index === 0 ? 'Oldest unique needle.' : `Synthetic message ${index}.`;
  return rich
    ? `${text}\n\n## Measured example\n\nA **stable** paragraph with [a link](https://example.invalid).\n\n\`\`\`typescript\nconst sample = ${index};\nconsole.log(sample);\n\`\`\`\n\n| Key | Value |\n| --- | --- |\n| row | ${index} |`
    : `${text} ${'Ordinary conversation text. '.repeat(16)}`;
}

export function clientHistory(count: number, rich = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`, sessionId: 'fixture-client', provider: 'claude' as const,
    kind: 'text' as const, role: index % 2 ? 'assistant' as const : 'user' as const,
    timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    content: fixtureText(index, rich),
  }));
}

export function transcriptRow(provider: HistoryProvider, nativeId: string, index: number, profile: HistoryProfile = 'plain') {
  const role = index % 2 ? 'assistant' : 'user';
  const timestamp = new Date(1_700_000_000_000 + index * 1000).toISOString();
  // Bursts: per 40 records a prompt, 17 tool calls with results, then replies, as tool-heavy sessions run.
  const burst = index % 40;
  const tool = profile === 'bursts' ? burst % 2 === 1 && burst < 35 : profile !== 'plain' && index % 20 === 1;
  const result = profile === 'bursts' ? burst % 2 === 0 && burst > 0 && burst < 35 : profile !== 'plain' && index % 20 === 2;
  const output = 'synthetic output\n'.repeat(profile === 'heavy' ? 20_000 : profile === 'bursts' ? 8 : 1024);
  const image = profile === 'bursts' ? burst === 38 : profile !== 'plain' && index % 20 === 4;
  if (provider === 'codex') {
    const payload = tool
      ? { type: 'function_call', name: 'exec_command', call_id: `call-${index}`, arguments: JSON.stringify({ cmd: 'echo fixture' }) }
      : result
        ? { type: 'function_call_output', call_id: `call-${index - 1}`, output }
        : { type: 'message', id: `native-row-${index}`, role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: fixtureText(index, profile !== 'plain') }] };
    return { type: 'response_item', timestamp, payload };
  }
  const content = tool
    ? [{ type: 'tool_use', id: `call-${index}`, name: 'Bash', input: { command: 'echo fixture' } }]
    : result
      ? [{ type: 'tool_result', tool_use_id: `call-${index - 1}`, content: output }]
      : image
        ? [{ type: 'text', text: fixtureText(index, true) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }]
        : fixtureText(index, profile !== 'plain');
  return { sessionId: nativeId, uuid: `row-${index}`, parentUuid: index ? `row-${index - 1}` : null,
    timestamp, type: role, message: { role, content },
    ...(profile !== 'plain' && profile !== 'bursts' && index % 20 === 6 ? { isMeta: true } : {}),
  };
}
