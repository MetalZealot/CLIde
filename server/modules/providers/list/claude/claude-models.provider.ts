import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readProviderSessionActiveModelChange,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the Claude Code default model (set by your Claude settings or plan)',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable',
      description: 'Fable 5 · Most capable for your hardest and longest-running tasks · Uses your limits ~2× faster than Opus',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: "sonnet",
      label: "Sonnet",
      description: "Sonnet 5 · Best for everyday tasks · $3/$15 per Mtok",
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Sonnet 5 for long sessions · $3/$15 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opus[1m]',
      label: 'Opus 4.8 (1M context)',
      description: 'Opus 4.8 with 1M context · Most capable for complex work · $5/$25 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
    },
  ],
  DEFAULT: 'default',
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

  const lowered = normalized.toLowerCase();
  const wantsLongContext = lowered.includes('[1m]');
  for (const option of options) {
    if (option.value === 'default') {
      continue;
    }

    const family = option.value.replace(/\[1m\]$/, '');
    if (lowered.includes(family) && option.value.endsWith('[1m]') === wantsLongContext) {
      return option.value;
    }
  }

  return normalized;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

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
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
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
): Promise<ProviderCurrentActiveModel | null> => {
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
        return { model };
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
  activeModelChangesPath?: string;
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
    const configuredDefaultModel = await this.readConfiguredDefaultModel();
    if (!configuredDefaultModel) {
      return CLAUDE_FALLBACK_MODELS;
    }

    return {
      ...CLAUDE_FALLBACK_MODELS,
      OPTIONS: CLAUDE_FALLBACK_MODELS.OPTIONS.map((option) =>
        option.value === 'default'
          ? {
              ...option,
              description: `Use the Claude Code default model (currently ${configuredDefaultModel}, from your Claude settings)`,
            }
          : option,
      ),
    };
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    // A stored picker selection is authoritative: resolveResumeModel injects
    // it on every resumed turn, so it is what the session actually runs.
    const changedModel = await readProviderSessionActiveModelChange('claude', normalizedSessionId, {
      filePath: this.deps.activeModelChangesPath,
    });
    if (changedModel.changed && changedModel.model) {
      return { model: changedModel.model };
    }

    try {
      const sessionRow = this.lookupSessionRow(normalizedSessionId);
      const jsonlPath = sessionRow?.jsonl_path;
      // Transcript events carry the provider-native session id, not the
      // app-level id the frontend sends with commands.
      const transcriptSessionId = sessionRow?.provider_session_id || normalizedSessionId;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(transcriptSessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        const supportedModels = await this.getSupportedModels();
        return { model: resolveClaudeModelAlias(activeModel.model, supportedModels.OPTIONS) };
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}
