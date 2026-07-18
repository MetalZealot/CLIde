function readUsageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalizes the token count that represents the *current* Codex context.
 *
 * Codex emits `total_token_usage` as the cumulative cost for the lifetime of
 * a rollout. It can therefore exceed `model_context_window`, particularly
 * after compaction. `last_token_usage` is the most recent request's context
 * and is the appropriate value for a context-window indicator.
 */
export function extractCodexContextTokenUsage(info, fallbackUsage = null) {
  const tokenInfo = info && typeof info === 'object' ? info : null;
  const usage = tokenInfo?.last_token_usage
    || tokenInfo?.total_token_usage
    || fallbackUsage;

  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = readUsageNumber(usage.output_tokens ?? usage.outputTokens);

  return {
    used: readUsageNumber(usage.total_tokens ?? usage.totalTokens) || inputTokens + outputTokens,
    total: readUsageNumber(tokenInfo?.model_context_window ?? tokenInfo?.modelContextWindow) || 200000,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}
