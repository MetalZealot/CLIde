import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { sessionsDb } from '@/modules/database/index.js';
import {
  readCodexModelList,
  type CodexLiveModel,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import { readCodexSessionModelFromRollout } from '@/modules/providers/list/codex/codex-session-model.js';
import { pickSupersedesTranscript } from '@/modules/providers/list/claude/claude-models.provider.js';
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
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.5',
      label: 'gpt-5.5',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'gpt-5.4',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'gpt-5.4-mini',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.4',
  source: 'fallback',
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

const buildCachedCodexModelsDefinition = (
  models: CodexCachedModel[],
): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
    source: 'stale',
  };
};

const mapLiveCodexModel = (model: CodexLiveModel): ProviderModelOption => ({
  value: model.model || model.id,
  label: model.displayName || model.model || model.id,
  description: model.description || undefined,
  isDefault: model.isDefault || undefined,
  effort: model.supportedReasoningEfforts.length > 0
    ? {
        default: model.defaultReasoningEffort || undefined,
        values: model.supportedReasoningEfforts.map((effort) => ({
          value: effort.reasoningEffort,
          description: effort.description || undefined,
        })),
      }
    : undefined,
});

const buildLiveCodexModelsDefinition = (
  models: CodexLiveModel[],
): ProviderModelsDefinition | null => {
  const options = models
    .filter((model) => !model.hidden && Boolean(model.model || model.id))
    .map(mapLiveCodexModel);
  if (options.length === 0) {
    return null;
  }
  const selectedDefault = options.find((option) => option.isDefault)?.value ?? options[0].value;
  return {
    OPTIONS: options,
    DEFAULT: selectedDefault,
    source: 'live',
  };
};

type CodexProviderModelsOptions = {
  readLiveModels?: () => Promise<CodexLiveModel[]>;
  modelsCachePath?: string;
  configPath?: string;
  modelPickStore?: SessionModelPickStore;
  lookupSessionRow?: (sessionId: string) => {
    provider_session_id?: string | null;
    jsonl_path?: string | null;
  } | null;
};

export class CodexProviderModels implements IProviderModels {
  private readonly readLiveModels: () => Promise<CodexLiveModel[]>;
  private readonly modelsCachePath: string;
  private readonly configPath: string;
  private readonly modelPickStore?: SessionModelPickStore;
  private readonly lookupSessionRow: NonNullable<CodexProviderModelsOptions['lookupSessionRow']>;

  constructor(options: CodexProviderModelsOptions = {}) {
    this.readLiveModels = options.readLiveModels ?? (() => readCodexModelList());
    this.modelsCachePath = options.modelsCachePath ?? CODEX_MODELS_CACHE_PATH;
    this.configPath = options.configPath ?? CODEX_CONFIG_PATH;
    this.modelPickStore = options.modelPickStore;
    this.lookupSessionRow = options.lookupSessionRow ?? ((sessionId) => sessionsDb.getSessionById(sessionId));
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const live = buildLiveCodexModelsDefinition(await this.readLiveModels());
      if (live) {
        return live;
      }
      throw new Error('Codex returned an empty model catalog.');
    } catch {
      // The CLI cache is explicitly stale evidence, but is better than a
      // hardcoded catalog when the selected runtime cannot answer model/list.
    }

    try {
      const raw = await readFile(this.modelsCachePath, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCachedCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const normalizedSessionId = sessionId?.trim();
    if (normalizedSessionId) {
      const picked = await readProviderSessionModelPick('codex', normalizedSessionId, {
        store: this.modelPickStore,
      });

      let transcriptModel = null;
      try {
        const rolloutPath = this.lookupSessionRow(normalizedSessionId)?.jsonl_path;
        transcriptModel = rolloutPath
          ? await readCodexSessionModelFromRollout(rolloutPath)
          : null;
      } catch {
        transcriptModel = null;
      }

      if (
        picked.changed
        && picked.model?.trim()
        && pickSupersedesTranscript(picked.updatedAt, transcriptModel?.timestamp)
      ) {
        return {
          model: picked.model.trim(),
          source: 'pick',
        };
      }

      if (transcriptModel?.model) {
        return {
          model: transcriptModel.model,
          source: 'transcript',
        };
      }
    }

    try {
      const raw = await readFile(this.configPath, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      // ~/.codex/config.toml is global Codex configuration, not per-session
      // state, so it must not be reported as this session's own model.
      return {
        model,
        source: 'default',
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionModelPick('codex', input, { store: this.modelPickStore });
  }

  async getTranscriptTurnTimestamp(sessionId: string): Promise<string | undefined> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return undefined;
    }

    try {
      const rolloutPath = this.lookupSessionRow(normalizedSessionId)?.jsonl_path;
      const transcriptModel = rolloutPath
        ? await readCodexSessionModelFromRollout(rolloutPath)
        : null;
      return transcriptModel?.timestamp;
    } catch {
      return undefined;
    }
  }
}
