/**
 * Authoritative context ceilings, read from the SDK instead of derived.
 *
 * `claude-context-window.ts` reconstructs the ring's denominator from a
 * hand-mirrored copy of the SDK's model registry. That works everywhere, but it
 * is a copy, and an empirical probe (`scripts/verify-context-usage-sdk.ts`,
 * 2026-07-27) showed it disagrees with what Claude Code actually uses:
 *
 *     claude-haiku-4-5  SDK 200000   derived 180000
 *     claude-sonnet-5   SDK 967000   derived 980000
 *
 * The SDK will simply tell us, via the `getContextUsage()` control request:
 * `maxTokens` is the denominator, and `autoCompactThreshold` is the point where
 * the conversation gets compacted out from under the user — which the ring had
 * no way to show before.
 *
 * Two constraints from that probe shape everything here:
 *
 *   - it only answers MID-TURN. At the terminal `result` message the transport
 *     is already closing ("Query closed before response received"), and once
 *     the generator returns the query is gone. So the reading has to be taken
 *     while a turn is streaming and remembered afterwards.
 *   - it costs 780-1200ms. Far too slow to await inline in the message loop, so
 *     callers fire it once per turn and let it land when it lands.
 *
 * Hence this cache: the live path fills it during a turn, and both the live
 * path and the `/token-usage` endpoint read it afterwards. It is process-local
 * and best-effort — every consumer must still fall back to
 * `resolveClaudeContextCeiling` when there is no entry (a session resumed after
 * a restart, or one whose first turn has not streamed yet).
 */

/** Sessions tracked before the oldest entries are evicted. */
const MAX_TRACKED_SESSIONS = 200;

export type ClaudeContextCeiling = {
  /** `SDKControlGetContextUsageResponse.maxTokens` — the ring's denominator. */
  maxTokens: number;
  /** Where auto-compact fires, when the CLI reports one. */
  autoCompactThreshold?: number;
  /** Whether auto-compact is on for this session at all. */
  isAutoCompactEnabled: boolean;
  /** Model the CLI resolved for the session, e.g. `claude-haiku-4-5-20251001`. */
  model?: string;
  /** Usage at the moment of the reading; kept for diagnostics, not for the ring. */
  totalTokens?: number;
  fetchedAt: number;
};

/** Minimal shape of the control request, so this module does not depend on the SDK's types. */
type ContextUsageSource = {
  getContextUsage?: () => Promise<unknown>;
};

const ceilings = new Map<string, ClaudeContextCeiling>();

const readPositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

/**
 * Narrows a raw `getContextUsage()` payload to the fields the ring needs.
 * Returns null when the response carries no usable ceiling, so a malformed or
 * future-shaped payload degrades to the derived fallback rather than poisoning
 * the cache with a zero denominator.
 */
export const parseClaudeContextUsage = (payload: unknown): ClaudeContextCeiling | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const raw = payload as Record<string, unknown>;
  const maxTokens = readPositiveInteger(raw.maxTokens) ?? readPositiveInteger(raw.rawMaxTokens);
  if (maxTokens === undefined) {
    return null;
  }

  return {
    maxTokens,
    autoCompactThreshold: readPositiveInteger(raw.autoCompactThreshold),
    isAutoCompactEnabled: raw.isAutoCompactEnabled === true,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined,
    totalTokens: readPositiveInteger(raw.totalTokens),
    fetchedAt: Date.now(),
  };
};

export const rememberClaudeContextCeiling = (
  sessionId: string | null | undefined,
  ceiling: ClaudeContextCeiling,
): void => {
  if (!sessionId) {
    return;
  }

  // Re-inserting moves the key to the end of the Map's insertion order, so the
  // eviction below always drops the least recently written session.
  ceilings.delete(sessionId);
  ceilings.set(sessionId, ceiling);

  while (ceilings.size > MAX_TRACKED_SESSIONS) {
    const oldest = ceilings.keys().next();
    if (oldest.done) {
      break;
    }
    ceilings.delete(oldest.value);
  }
};

export const getClaudeContextCeiling = (
  sessionId: string | null | undefined,
): ClaudeContextCeiling | null => (sessionId ? ceilings.get(sessionId) ?? null : null);

/** Test seam. */
export const clearClaudeContextCeilings = (): void => {
  ceilings.clear();
};

/**
 * Asks a live query for its context usage and caches the result.
 *
 * Never throws and never rejects: the control request fails routinely for
 * reasons that are not errors from the ring's point of view (the turn ended
 * first, an older CLI without the control request, a transport that already
 * closed). Callers treat a null return as "keep using the derived ceiling".
 */
export const captureClaudeContextUsage = async (
  sessionId: string | null | undefined,
  source: ContextUsageSource | null | undefined,
): Promise<ClaudeContextCeiling | null> => {
  if (!sessionId || typeof source?.getContextUsage !== 'function') {
    return null;
  }

  try {
    const ceiling = parseClaudeContextUsage(await source.getContextUsage());
    if (!ceiling) {
      return null;
    }
    rememberClaudeContextCeiling(sessionId, ceiling);
    return ceiling;
  } catch {
    return null;
  }
};
