import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import {
  readProviderSessionModelPick,
  writeProviderSessionModelPick,
  type SessionModelPickStore,
} from '@/modules/providers/services/provider-session-model.service.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

// Every effort-capable Claude model exposes the same five levels, so they share
// one frozen block rather than repeating it per option. The catalog is only ever
// serialised to JSON, so sharing the reference is safe.
const CLAUDE_EFFORT_LEVELS: ProviderModelOption['effort'] = Object.freeze({
  default: 'high',
  values: Object.freeze([
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ]),
}) as ProviderModelOption['effort'];

// Labels carry the version number ("Opus 5", not "Opus") because the
// composer picker renders the label alone — it never shows `description`
// (ComposerModelMenu.tsx), so a bare family name leaves no way to
// tell which generation you are picking. Current models use the floating alias
// as their `value`, so these labels need bumping by hand whenever Claude ships
// a new generation; legacy entries pin a concrete id, which is the point of them.
//
// There is deliberately no `[1m]` option for any model. The suffix opts into the
// 1M-context beta, which only means something where 1M is not already native —
// third-party platforms (Bedrock/Vertex/Foundry) and Pro-tier accounts. Talking
// to api.anthropic.com above Pro, every model is natively 1M, Claude Code
// suppresses its own "(1M context)" rows, and sending the suffix changes nothing
// except billing the long-context premium under a separate usage key.
export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'fable',
      label: 'Fable 5',
      description: 'Most capable for your hardest and longest-running tasks · Uses your limits ~2× faster than Opus',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'sonnet',
      label: 'Sonnet 5',
      description: 'Best for everyday tasks · $3/$15 per Mtok',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'opus',
      label: 'Opus 5',
      description: 'Best for everyday, complex tasks · $5/$25 per Mtok',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'haiku',
      label: 'Haiku 4.5',
      description: 'Fastest for quick answers · $1/$5 per Mtok',
    },
    // Claude Code hides these behind its third-party menu branch, but they still
    // run as themselves on a first-party account. Opus 4.1 and 4.0 are
    // deliberately absent: the CLI's deprecation table remaps them to the latest
    // Opus unless CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP is set, so a row for
    // them would name a model the session would not actually use.
    {
      value: 'claude-opus-4-8',
      label: 'Opus 4.8',
      description: 'Previous Opus version',
      group: 'legacy',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'claude-opus-4-7',
      label: 'Opus 4.7',
      description: 'Legacy',
      group: 'legacy',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'claude-opus-4-6',
      label: 'Opus 4.6',
      description: 'Legacy',
      group: 'legacy',
      effort: CLAUDE_EFFORT_LEVELS,
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      description: 'Legacy',
      group: 'legacy',
      effort: CLAUDE_EFFORT_LEVELS,
    },
  ],
  // Only a display/seed fallback for when the configured default cannot be read;
  // `getSupportedModels` replaces it with the real one. Claude Code's own
  // built-in fallback is Sonnet, so this matches what an unconfigured machine
  // would actually run.
  DEFAULT: 'sonnet',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};

/**
 * Maps a full model id from a session transcript (e.g. `claude-fable-5`) back
 * to the picker alias (`fable`) so the frontend can highlight the matching
 * catalog option. Unknown ids are returned unchanged so the UI still shows the
 * real model instead of silently falling back to the default.
 */
export const resolveClaudeModelAlias = (
  model: string,
  options: ProviderModelOption[],
): string => {
  const normalized = model.trim();
  if (!normalized || options.some((option) => option.value === normalized)) {
    return normalized;
  }

  // The catalog offers no `[1m]` variants, so a transcript that recorded one
  // still belongs on its base model's row rather than on no row at all.
  const lowered = normalized.toLowerCase().replace(/\[1m\]/g, '');

  // Longest match wins. `claude-opus-4-8-20260101` contains both `opus` and
  // `claude-opus-4-8`, and only the second names the model that actually ran —
  // a first-match loop would highlight Opus 5 for an Opus 4.8 session.
  let best: string | null = null;
  for (const option of options) {
    const family = option.value.toLowerCase();
    if (!lowered.includes(family)) {
      continue;
    }
    if (best === null || family.length > best.length) {
      best = option.value;
    }
  }

  return best ?? normalized;
};
/**
 * Decides whether a stored popup pick still represents the session, given when
 * the pick was recorded and when the last transcript turn ran. The pick wins
 * only when it is at least as recent as that turn; a newer turn means the model
 * has since changed by a path the cache never observed, so the transcript wins.
 * When either timestamp is missing/unparseable we bias toward whichever signal
 * we can trust: no turn to compare against -> the pick stands; an undateable
 * pick -> defer to the transcript.
 */
export const pickSupersedesTranscript = (
  pickUpdatedAt?: string,
  transcriptTimestamp?: string,
): boolean => {
  if (!transcriptTimestamp) {
    return true;
  }
  const turnTime = Date.parse(transcriptTimestamp);
  if (Number.isNaN(turnTime)) {
    return true;
  }
  if (!pickUpdatedAt) {
    return false;
  }
  const pickTime = Date.parse(pickUpdatedAt);
  if (Number.isNaN(pickTime)) {
    return false;
  }
  return pickTime >= turnTime;
};

type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  timestamp?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

type ClaudeSessionTranscriptModel = {
  model: string;
  timestamp?: string;
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

// Claude Code stamps locally-fabricated assistant rows (API-error notices,
// "No response requested.", session-limit messages) with the placeholder
// model "<synthetic>". Adopting it would feed a non-model into the send path,
// so placeholder values are skipped and the transcript scan keeps walking back
// to the last real turn.
const isPlaceholderClaudeModel = (value: string): boolean => /^<.*>$/.test(value);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel && !isPlaceholderClaudeModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  if (messageModel && !isPlaceholderClaudeModel(messageModel)) {
    return messageModel;
  }

  return null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ClaudeSessionTranscriptModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return {
          model,
          timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
        };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

type ClaudeSessionRow = {
  provider_session_id?: string | null;
  jsonl_path?: string | null;
};

type ClaudeProviderModelsDeps = {
  getSessionRow?: (sessionId: string) => ClaudeSessionRow | null;
  modelPickStore?: SessionModelPickStore;
  claudeSettingsPath?: string;
};

export class ClaudeProviderModels implements IProviderModels {
  constructor(private readonly deps: ClaudeProviderModelsDeps = {}) {}

  private lookupSessionRow(sessionId: string): ClaudeSessionRow | null {
    return this.deps.getSessionRow
      ? this.deps.getSessionRow(sessionId)
      : sessionsDb.getSessionById(sessionId);
  }

  /**
   * Resolves what "default" actually runs for this machine, mirroring Claude
   * Code's own precedence: ANTHROPIC_MODEL env, then the `model` key in
   * ~/.claude/settings.json. Returns null when neither is set (the plan
   * default applies and we cannot know it here).
   */
  private async readConfiguredDefaultModel(): Promise<string | null> {
    const envModel = process.env.ANTHROPIC_MODEL?.trim();
    if (envModel) {
      return envModel;
    }

    const settingsPath = this.deps.claudeSettingsPath
      ?? path.join(os.homedir(), '.claude', 'settings.json');
    try {
      const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { model?: unknown };
      const model = typeof settings.model === 'string' ? settings.model.trim() : '';
      return model || null;
    } catch {
      return null;
    }
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    // claude creates a new jsonl file as a separate session for this request.
    // As a result, it lists the workspace where this is invoked when it shouldn't.
    //
    // Disabled for now:
    // const queryInstance = query({
    //   prompt: 'Get supported models',
    //   options: buildClaudeQueryOptions(),
    // });
    // const supportedModels = await queryInstance.supportedModels();
    // queryInstance.close();
    // return buildClaudeModelsDefinition(supportedModels);
    // There is no "Default" row to describe any more — the catalog names the
    // model that is actually the default and flags it, so the picker can badge
    // a real option instead of offering a pseudo-model. Sending the literal
    // string "default" was never a working alias: Claude Code does not
    // recognise it and falls back to its built-in Sonnet default, ignoring the
    // user's configured `model` entirely.
    const configuredDefaultModel = await this.readConfiguredDefaultModel();
    if (!configuredDefaultModel) {
      return CLAUDE_FALLBACK_MODELS;
    }

    const defaultValue = resolveClaudeModelAlias(
      configuredDefaultModel,
      CLAUDE_FALLBACK_MODELS.OPTIONS,
    );
    if (!CLAUDE_FALLBACK_MODELS.OPTIONS.some((option) => option.value === defaultValue)) {
      return CLAUDE_FALLBACK_MODELS;
    }

    return {
      OPTIONS: CLAUDE_FALLBACK_MODELS.OPTIONS.map((option) =>
        option.value === defaultValue ? { ...option, isDefault: true } : option,
      ),
      DEFAULT: defaultValue,
    };
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    const changedModel = await readProviderSessionModelPick('claude', normalizedSessionId, {
      store: this.deps.modelPickStore,
    });
    // Sessions picked before the "Default" row was removed still carry that
    // literal, which never named a model. Treat it as no pick rather than
    // rewriting the row: the session then falls through to its transcript,
    // which is what actually ran.
    const pickedModel = changedModel.model === 'default' ? null : changedModel.model;
    const hasPendingPick = changedModel.changed && Boolean(pickedModel);

    let transcriptModel: ClaudeSessionTranscriptModel | null = null;
    try {
      const sessionRow = this.lookupSessionRow(normalizedSessionId);
      const jsonlPath = sessionRow?.jsonl_path;
      // Transcript events carry the provider-native session id, not the
      // app-level id the frontend sends with commands.
      const transcriptSessionId = sessionRow?.provider_session_id || normalizedSessionId;
      transcriptModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(transcriptSessionId, jsonlPath)
        : null;
    } catch {
      transcriptModel = null;
    }

    // A stored popup pick applies on the next turn, so it only reflects the
    // session while it is at least as recent as the last recorded turn. Once a
    // newer turn exists, the model may have changed by a path the cache never
    // saw (fast mode, a Shell /model), and the transcript is the ground truth.
    if (hasPendingPick && pickSupersedesTranscript(changedModel.updatedAt, transcriptModel?.timestamp)) {
      // Normalised for the same reason as the transcript path: a pick recorded
      // against a since-removed row (`opus[1m]`) still belongs on the row that
      // supersedes it, or the picker highlights nothing.
      const supportedModels = await this.getSupportedModels();
      return {
        model: resolveClaudeModelAlias(pickedModel as string, supportedModels.OPTIONS),
        source: 'pick',
      };
    }

    if (transcriptModel?.model) {
      const supportedModels = await this.getSupportedModels();
      return {
        model: resolveClaudeModelAlias(transcriptModel.model, supportedModels.OPTIONS),
        source: 'transcript',
      };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionModelPick('claude', input, { store: this.deps.modelPickStore });
  }

  async getTranscriptTurnTimestamp(sessionId: string): Promise<string | undefined> {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) {
      return undefined;
    }

    try {
      const sessionRow = this.lookupSessionRow(normalizedSessionId);
      const jsonlPath = sessionRow?.jsonl_path;
      const transcriptSessionId = sessionRow?.provider_session_id || normalizedSessionId;
      const transcriptModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(transcriptSessionId, jsonlPath)
        : null;
      return transcriptModel?.timestamp;
    } catch {
      return undefined;
    }
  }
}
