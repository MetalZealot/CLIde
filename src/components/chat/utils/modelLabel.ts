/**
 * `claude-opus-5-5` → `Opus 5.5`, `claude-3-5-sonnet-20241022` → `Sonnet 3.5`.
 * An id that does not parse is shown as-is, so a new naming scheme degrades to the raw id.
 */
export function formatModelLabel(modelId: string): string {
  const oneMillion = /\[1m\]$/i.test(modelId);
  const tokens = modelId.replace(/\[1m\]$/i, '').replace(/^claude-/, '').split('-');
  const family = tokens.find((token) => /^[a-z]+$/i.test(token));
  const version = tokens.filter((token) => /^\d{1,2}$/.test(token)).join('.');
  if (!family || !modelId.startsWith('claude-')) return modelId;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`;
  return oneMillion ? `${name} 1M` : name;
}
