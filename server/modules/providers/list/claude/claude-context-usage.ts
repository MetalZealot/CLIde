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
 * path and the `/token-usage` endpoint read it afterwards.
 *
 * The cache is also written through to disk, one small JSON file per session
 * under the database's own directory. Holding it only in memory made `/context`
 * blank for every session after a restart and for every session resumed from
 * history — which is most of the time anyone opens it. On disk, the last
 * reading a session ever produced survives, and consumers show it with its
 * `fetchedAt` timestamp rather than nothing. Still best-effort: a session that
 * has never streamed a turn has no reading at all, so every consumer must keep
 * its `resolveClaudeContextCeiling` fallback.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/** Sessions tracked in memory before the oldest entries are evicted. */
const MAX_TRACKED_SESSIONS = 200;

/** Sessions kept on disk. Each file is a few KB, so this is a housekeeping cap. */
const MAX_PERSISTED_SESSIONS = 200;

/**
 * Session ids that are safe to use as a filename verbatim. Claude's ids are
 * UUIDs, so this rejects nothing in practice — it exists so a future id shape
 * carrying a separator can never escape the store directory. Ids that fail it
 * stay memory-only rather than being mangled into a colliding filename.
 */
const PERSISTABLE_SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Guards against a `..` id, belt-and-braces alongside the pattern above. */
const isPersistableSessionId = (sessionId: string): boolean =>
  PERSISTABLE_SESSION_ID.test(sessionId) && sessionId !== '.' && sessionId !== '..';

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

/**
 * Where readings are persisted.
 *
 * It follows the database rather than the home directory directly, so an
 * instance pointed at another database (the branch-test harness, a second
 * install) keeps its own readings instead of writing into the live one's.
 * Resolved per call because `DATABASE_PATH` is set during startup.
 */
const resolveStoreDir = (): string => {
  const databasePath = process.env.DATABASE_PATH;
  const baseDir = databasePath
    ? path.dirname(databasePath)
    : path.join(os.homedir(), '.cloudcli');
  return path.join(baseDir, 'context-usage');
};

const storeFilePath = (sessionId: string): string =>
  path.join(resolveStoreDir(), `${sessionId}.json`);

/**
 * Drops the oldest files once the store outgrows its cap.
 *
 * Sessions are never explicitly deleted here — a reading outlives the session
 * row it describes — so without this the directory would grow forever.
 */
const pruneStore = async (storeDir: string): Promise<void> => {
  const names = (await fs.readdir(storeDir)).filter((name) => name.endsWith('.json'));
  if (names.length <= MAX_PERSISTED_SESSIONS) {
    return;
  }

  const stamped = await Promise.all(names.map(async (name) => {
    try {
      const stats = await fs.stat(path.join(storeDir, name));
      return { name, modifiedAt: stats.mtimeMs };
    } catch {
      // Vanished under us (a concurrent prune); sorting it first makes the
      // delete below a no-op rather than a special case.
      return { name, modifiedAt: 0 };
    }
  }));

  stamped.sort((left, right) => left.modifiedAt - right.modifiedAt);

  await Promise.all(
    stamped
      .slice(0, stamped.length - MAX_PERSISTED_SESSIONS)
      .map((entry) => fs.rm(path.join(storeDir, entry.name), { force: true })),
  );
};

/**
 * Writes one reading to disk. Never throws: persistence is an optimisation, and
 * a full or read-only disk must not take down the turn that triggered it.
 *
 * The write is atomic (temp file + rename) so a crash mid-write leaves the
 * previous reading intact rather than a truncated file that fails to parse.
 */
const persistCeiling = async (sessionId: string, ceiling: ClaudeContextCeiling): Promise<void> => {
  try {
    const storeDir = resolveStoreDir();
    await fs.mkdir(storeDir, { recursive: true, mode: 0o700 });

    const target = storeFilePath(sessionId);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, sessionId, ceiling }), { mode: 0o600 });
    await fs.rename(temp, target);

    await pruneStore(storeDir);
  } catch {
    // Memory-only for this session; the next turn will try again.
  }
};

/**
 * Rebuilds a reading from its persisted form.
 *
 * The file was written from an already-parsed ceiling, so this validates the
 * one field everything depends on and passes the rest through. A file that
 * fails validation is treated as absent, which falls back to the derived
 * ceiling — the same path as a session that never streamed a turn.
 */
const reviveCeiling = (raw: unknown): ClaudeContextCeiling | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const stored = (raw as Record<string, unknown>).ceiling;
  if (!stored || typeof stored !== 'object') {
    return null;
  }

  const record = stored as Record<string, unknown>;
  const maxTokens = readPositiveInteger(record.maxTokens);
  if (maxTokens === undefined) {
    return null;
  }

  return {
    ...(record as unknown as ClaudeContextCeiling),
    maxTokens,
    isAutoCompactEnabled: record.isAutoCompactEnabled === true,
    fetchedAt: readPositiveInteger(record.fetchedAt) ?? 0,
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

  if (isPersistableSessionId(sessionId)) {
    // Deliberately not awaited: this runs inside a streaming turn, and the
    // caller has nothing to do with the outcome.
    void persistCeiling(sessionId, ceiling);
  }
};

/**
 * Synchronous, memory-only read — for the streaming path, which resolves a
 * ceiling per frame and cannot afford to touch the disk.
 */
export const getClaudeContextCeiling = (
  sessionId: string | null | undefined,
): ClaudeContextCeiling | null => (sessionId ? ceilings.get(sessionId) ?? null : null);

/**
 * Full read: memory first, then the persisted reading from a previous turn or a
 * previous process. Use this anywhere a request can afford one file read —
 * it is what makes `/context` work on a resumed session.
 */
export const loadClaudeContextCeiling = async (
  sessionId: string | null | undefined,
): Promise<ClaudeContextCeiling | null> => {
  if (!sessionId) {
    return null;
  }

  const cached = ceilings.get(sessionId);
  if (cached) {
    return cached;
  }

  if (!isPersistableSessionId(sessionId)) {
    return null;
  }

  try {
    const ceiling = reviveCeiling(JSON.parse(await fs.readFile(storeFilePath(sessionId), 'utf8')));
    if (!ceiling) {
      return null;
    }

    // Warm the map so repeat reads (every session switch) stay in memory.
    ceilings.set(sessionId, ceiling);
    return ceiling;
  } catch {
    // No reading persisted for this session, or it is unreadable.
    return null;
  }
};

/** Test seam. Clears memory only; persisted files belong to the store directory. */
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
