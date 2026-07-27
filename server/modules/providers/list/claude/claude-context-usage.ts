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

/** One labelled slice of the context window, as the CLI's `/context` draws it. */
export type ClaudeContextCategory = {
  name: string;
  tokens: number;
  /** The CLI's own colour for this slice; passed through so both agree. */
  color?: string;
  isDeferred?: boolean;
};

export type ClaudeNamedTokens = { name: string; tokens: number };

/**
 * Everything behind the headline numbers — what the CLI's `/context` command
 * shows. Optional throughout: the CLI omits sections that do not apply (no MCP
 * servers configured, no skills loaded), and older CLIs omit more.
 */
export type ClaudeContextBreakdown = {
  categories: ClaudeContextCategory[];
  memoryFiles: { path: string; type?: string; tokens: number }[];
  mcpTools: { name: string; serverName?: string; tokens: number; isLoaded?: boolean }[];
  systemTools: ClaudeNamedTokens[];
  systemPromptSections: ClaudeNamedTokens[];
  agents: { name: string; source?: string; tokens: number }[];
  skills?: { totalSkills: number; includedSkills: number; tokens: number };
  slashCommands?: { totalCommands: number; includedCommands: number; tokens: number };
  messageBreakdown?: {
    toolCallTokens: number;
    toolResultTokens: number;
    attachmentTokens: number;
    assistantMessageTokens: number;
    userMessageTokens: number;
    redirectedContextTokens: number;
    unattributedTokens: number;
    attachmentsByType: ClaudeNamedTokens[];
  };
};

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
  /** Percentage of the window in use, as the CLI computed it. */
  percentage?: number;
  /**
   * The `/context` detail. Held alongside the ceiling because it arrives in the
   * same response and there is no way to re-ask once the turn is over — the
   * `/context` view has to render from whatever the last turn recorded.
   */
  breakdown?: ClaudeContextBreakdown;
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

const readNonNegativeNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Zero is meaningful in a breakdown ("this section costs nothing"), unlike in a ceiling. */
const readTokenCount = (value: unknown): number => readNonNegativeNumber(value) ?? 0;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];

const readNamedTokens = (value: unknown): ClaudeNamedTokens[] =>
  readRecords(value)
    .map((entry) => ({ name: readString(entry.name) ?? 'Unknown', tokens: readTokenCount(entry.tokens) }));

/**
 * Reshapes the `/context` detail off a raw payload.
 *
 * Everything is defensive: this is a control-request payload from a CLI that
 * ships independently of the app, so a section going missing or changing shape
 * has to degrade to "that section is empty", never to a crash in the modal.
 */
const parseBreakdown = (raw: Record<string, unknown>): ClaudeContextBreakdown => {
  const skills = raw.skills as Record<string, unknown> | undefined;
  const slashCommands = raw.slashCommands as Record<string, unknown> | undefined;
  const messages = raw.messageBreakdown as Record<string, unknown> | undefined;

  return {
    categories: readRecords(raw.categories).map((entry) => ({
      name: readString(entry.name) ?? 'Unknown',
      tokens: readTokenCount(entry.tokens),
      color: readString(entry.color),
      isDeferred: entry.isDeferred === true,
    })),
    memoryFiles: readRecords(raw.memoryFiles).map((entry) => ({
      path: readString(entry.path) ?? 'Unknown',
      type: readString(entry.type),
      tokens: readTokenCount(entry.tokens),
    })),
    mcpTools: readRecords(raw.mcpTools).map((entry) => ({
      name: readString(entry.name) ?? 'Unknown',
      serverName: readString(entry.serverName),
      tokens: readTokenCount(entry.tokens),
      isLoaded: entry.isLoaded === true,
    })),
    systemTools: readNamedTokens(raw.systemTools),
    systemPromptSections: readNamedTokens(raw.systemPromptSections),
    agents: readRecords(raw.agents).map((entry) => ({
      name: readString(entry.agentType) ?? 'Unknown',
      source: readString(entry.source),
      tokens: readTokenCount(entry.tokens),
    })),
    skills: skills
      ? {
        totalSkills: readTokenCount(skills.totalSkills),
        includedSkills: readTokenCount(skills.includedSkills),
        tokens: readTokenCount(skills.tokens),
      }
      : undefined,
    slashCommands: slashCommands
      ? {
        totalCommands: readTokenCount(slashCommands.totalCommands),
        includedCommands: readTokenCount(slashCommands.includedCommands),
        tokens: readTokenCount(slashCommands.tokens),
      }
      : undefined,
    messageBreakdown: messages
      ? {
        toolCallTokens: readTokenCount(messages.toolCallTokens),
        toolResultTokens: readTokenCount(messages.toolResultTokens),
        attachmentTokens: readTokenCount(messages.attachmentTokens),
        assistantMessageTokens: readTokenCount(messages.assistantMessageTokens),
        userMessageTokens: readTokenCount(messages.userMessageTokens),
        redirectedContextTokens: readTokenCount(messages.redirectedContextTokens),
        unattributedTokens: readTokenCount(messages.unattributedTokens),
        attachmentsByType: readNamedTokens(messages.attachmentsByType),
      }
      : undefined,
  };
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
    percentage: readNonNegativeNumber(raw.percentage),
    breakdown: parseBreakdown(raw),
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
