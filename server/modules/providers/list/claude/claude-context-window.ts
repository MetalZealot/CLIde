import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Model-derived context ceiling for the Claude token ring.
 *
 * This module is the FALLBACK, for history reads, resumed sessions, and
 * anything else with no live query to ask. Where a query exists the SDK reports
 * its own ceiling and auto-compact threshold — authoritative, and free of the
 * mirroring problem below. See `claude-context-usage.ts`.
 *
 * Claude Code's algorithm, decoded from the CLI binary, 2026-07-26, re-decoded
 * from 2.1.233:
 *
 *   window = the model's registry `context.window`
 *   window = 200,000 flat when env CLAUDE_CODE_DISABLE_1M_CONTEXT is truthy —
 *            it fails every 1M path (`[1m]` suffix, beta header, native), so
 *            even a native-1M model falls through to the default window
 *   window = min(window, first cap that is set):
 *              env CLAUDE_CODE_AUTO_COMPACT_WINDOW
 *              → settings.json `autoCompactWindow`
 *              → a 200,000 "model-default" clamp, applied ONLY when the model's
 *                own window is < 1,000,000, so a 1M model falls through at its
 *                full window
 *   usable = window, less a 33,000 reserve on the 1M models (see
 *            LONG_CONTEXT_RESERVE — measured, not decoded)
 *
 * The model facts below are copied verbatim from the registry in
 * `@anthropic-ai/claude-agent-sdk` 0.3.233 (`sdk.mjs`): `context.window`,
 * `max_output_tokens.default`, and whether the entry declares 1M support. Never
 * write them from memory; refresh from that registry when the SDK is bumped.
 */

/**
 * Held back from the 1M models' window, and nothing else.
 *
 * Measured, not decoded: `scripts/verify-context-usage-sdk.ts` (2026-07-27) got
 * `maxTokens` 200000 for claude-haiku-4-5 (full registry window, no reserve) and
 * 967000 for claude-sonnet-5 (registry 1e6 less 33000). The same 33000 is
 * sonnet's "Autocompact buffer" category and the `maxTokens` /
 * `autoCompactThreshold` gap on both models.
 *
 * Only those two classes were sampled, so this reproduces an observation rather
 * than a rule from the binary, and is deliberately not applied below 1M.
 */
const LONG_CONTEXT_RESERVE = 33_000;

/** The "model-default" auto-compact clamp, skipped for 1M-window models. */
const MODEL_DEFAULT_WINDOW_CLAMP = 200_000;

/** Window a model reports once its 1M mode is in play. */
const LONG_CONTEXT_WINDOW = 1_000_000;

/**
 * Window assumed for a model this table has never heard of. Every Claude model
 * so far is at least 200K, so this under-reports a hypothetical future 1M model
 * rather than over-reporting a small one. The live-stream path avoids the guess
 * — the SDK hands it real numbers.
 */
const FALLBACK_WINDOW = MODEL_DEFAULT_WINDOW_CLAMP;

export type ClaudeModelContextSpec = {
  /**
   * Registry `context.window`. Absent on pre-4 entries, which carry no `context`
   * block; those fall back to the model-default clamp, as Claude Code does.
   */
  window?: number;
  /** Registry `max_output_tokens.default`. */
  maxOutputTokens: number;
  /**
   * Entry declares `native_1m`, `supports_1m_beta`, or `supports_1m_suffix` —
   * i.e. a `[1m]`-suffixed request can reach the 1M window.
   */
  supportsLongContext: boolean;
};

/** Registry entries, keyed by canonical model id. */
export const CLAUDE_MODEL_CONTEXT_SPECS: Readonly<Record<string, ClaudeModelContextSpec>> = {
  'claude-3-5-haiku': { maxOutputTokens: 8192, supportsLongContext: false },
  'claude-3-5-sonnet': { maxOutputTokens: 8192, supportsLongContext: false },
  'claude-3-7-sonnet': { maxOutputTokens: 32_000, supportsLongContext: false },
  'claude-haiku-4-5': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-sonnet-4-0': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-sonnet-4-5': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-sonnet-4-6': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-sonnet-5': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-opus-4-0': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-opus-4-1': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-opus-4-5': { window: 200_000, maxOutputTokens: 32_000, supportsLongContext: true },
  'claude-opus-4-6': { window: 200_000, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-opus-4-7': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-opus-4-8': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-opus-5': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-fable-5': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
  'claude-mythos-5': { window: LONG_CONTEXT_WINDOW, maxOutputTokens: 64_000, supportsLongContext: true },
};

/**
 * Non-canonical model strings that reach us, mapped onto registry ids.
 *
 * Floating family aliases come from the registry's own `aliases` block and
 * re-point on every SDK bump, so refresh them alongside the specs. The
 * `claude-opus-4` / `claude-sonnet-4` entries exist because those dated wire ids
 * reduce to a stem that is not the registry id; every other dated id reduces
 * cleanly.
 */
export const CLAUDE_MODEL_ID_ALIASES: Readonly<Record<string, string>> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
  mythos: 'claude-mythos-5',
  'claude-opus-4': 'claude-opus-4-0',
  'claude-sonnet-4': 'claude-sonnet-4-0',
};

const LONG_CONTEXT_SUFFIX = '[1m]';

const readPositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

/** Claude Code's boolean env vocabulary, decoded from the CLI binary. */
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

const readBooleanEnv = (value: string | undefined): boolean =>
  TRUTHY_ENV_VALUES.has(String(value ?? '').trim().toLowerCase());

/**
 * Reduces any model string we might see — picker alias, canonical id, dated
 * first-party id, Bedrock/Vertex/Mantle provider id — to a registry key, and
 * reports whether the caller asked for the 1M variant.
 */
export const normalizeClaudeModelId = (
  model: string | null | undefined,
): { id: string; wantsLongContext: boolean } => {
  const raw = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (!raw) {
    return { id: '', wantsLongContext: false };
  }

  const wantsLongContext = raw.includes(LONG_CONTEXT_SUFFIX);
  let id = raw.split(LONG_CONTEXT_SUFFIX).join('').trim();

  // Regional/provider prefixes: "us.anthropic.claude-opus-5", "anthropic.claude-haiku-4-5".
  id = id.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '');
  // Bedrock revision suffix: "...-20251001-v1:0".
  id = id.replace(/-v\d+:\d+$/, '');
  // Vertex date separator: "claude-sonnet-4-5@20250929".
  id = id.replace(/@\d{8}$/, '');
  // Vertex model revision: "claude-3-5-sonnet-v2".
  id = id.replace(/-v\d+$/, '');
  // Dated wire id: "claude-opus-4-1-20250805".
  id = id.replace(/-\d{8}$/, '');

  return { id: CLAUDE_MODEL_ID_ALIASES[id] ?? id, wantsLongContext };
};

/**
 * Looks up a model's registry facts. Null for anything not in the table,
 * including the `default` picker value, which names no model — by the time any
 * usage exists the transcript reports the concrete model instead.
 */
export const resolveClaudeModelContextSpec = (
  model: string | null | undefined,
): ClaudeModelContextSpec | null => {
  const { id } = normalizeClaudeModelId(model);
  return id ? CLAUDE_MODEL_CONTEXT_SPECS[id] ?? null : null;
};

type CachedSettingsWindow = { filePath: string; mtimeMs: number; window?: number };

/**
 * settings.json is re-read only when its mtime moves, so the live-stream path
 * can call this once per assistant frame without a parse each time.
 */
let settingsWindowCache: CachedSettingsWindow | null = null;

const readSettingsAutoCompactWindow = (settingsPath?: string): number | undefined => {
  const filePath = settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const { mtimeMs } = statSync(filePath);
    if (settingsWindowCache?.filePath === filePath && settingsWindowCache.mtimeMs === mtimeMs) {
      return settingsWindowCache.window;
    }
    const settings = JSON.parse(readFileSync(filePath, 'utf8')) as { autoCompactWindow?: unknown };
    const window = readPositiveInteger(settings.autoCompactWindow);
    settingsWindowCache = { filePath, mtimeMs, window };
    return window;
  } catch {
    // No settings file, unreadable, or malformed JSON — no cap configured.
    return undefined;
  }
};

/** Test seam: drops the memoized settings.json read. */
export const resetClaudeContextWindowCache = (): void => {
  settingsWindowCache = null;
};

/**
 * The `CONTEXT_WINDOW` operator override, when set.
 *
 * Exported so callers with a better source than this module's derivation — the
 * SDK's `maxTokens`, via `claude-context-usage.ts` — can still let the override
 * win. Nothing outranks it.
 */
export const readClaudeContextWindowOverride = (): number | undefined =>
  readPositiveInteger(process.env.CONTEXT_WINDOW);

export type ClaudeContextCeilingInput = {
  /** Model that produced the usage reading (transcript row, stream frame, or pick). */
  model?: string | null;
  /** Authoritative window, when the SDK supplied one (`ModelUsage.contextWindow`). */
  contextWindow?: number | null;
  /** Test seam for the settings.json lookup. */
  settingsPath?: string;
};

/**
 * Usable context tokens for a session running `model` — the denominator the
 * token ring divides by.
 *
 * `CONTEXT_WINDOW` wins when set, and is taken as the final ceiling rather than
 * a raw window to subtract from. An SDK-supplied `contextWindow` outranks the
 * local table, so a model shipped after this table still resolves sanely.
 */
export const resolveClaudeContextCeiling = (
  input: ClaudeContextCeilingInput = {},
): number => {
  const override = readPositiveInteger(process.env.CONTEXT_WINDOW);
  if (override !== undefined) {
    return override;
  }

  const { wantsLongContext } = normalizeClaudeModelId(input.model);
  const spec = resolveClaudeModelContextSpec(input.model);
  const longContextDisabled = readBooleanEnv(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT);

  let window = readPositiveInteger(input.contextWindow)
    ?? spec?.window
    ?? FALLBACK_WINDOW;

  if (wantsLongContext && (spec?.supportsLongContext ?? false) && !longContextDisabled) {
    window = Math.max(window, LONG_CONTEXT_WINDOW);
  }

  // The runtime resolves every model to the default window while this is set,
  // so it outranks both the registry and an SDK-reported window.
  if (longContextDisabled) {
    window = Math.min(window, MODEL_DEFAULT_WINDOW_CLAMP);
  }

  const configuredCap = readPositiveInteger(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
    ?? readSettingsAutoCompactWindow(input.settingsPath);

  if (configuredCap !== undefined) {
    window = Math.min(window, configuredCap);
  } else if (window < LONG_CONTEXT_WINDOW) {
    window = Math.min(window, MODEL_DEFAULT_WINDOW_CLAMP);
  }

  return window >= LONG_CONTEXT_WINDOW
    ? Math.max(0, window - LONG_CONTEXT_RESERVE)
    : window;
};
