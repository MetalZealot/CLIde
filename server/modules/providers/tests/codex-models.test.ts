import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CODEX_FALLBACK_MODELS,
  CodexProviderModels,
} from '@/modules/providers/list/codex/codex-models.provider.js';
import type { CodexLiveModel } from '@/modules/providers/list/codex/codex-app-server.client.js';

const LIVE_MODEL: CodexLiveModel = {
  id: 'gpt-live-id',
  model: 'gpt-live',
  displayName: 'GPT Live',
  description: 'Selected runtime model',
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'medium', description: 'Balanced' },
    { reasoningEffort: 'high', description: 'Deep' },
  ],
  defaultReasoningEffort: 'medium',
  isDefault: true,
};

test('Codex models prefer the selected runtime live catalog', async () => {
  const provider = new CodexProviderModels({
    readLiveModels: async () => [LIVE_MODEL, { ...LIVE_MODEL, id: 'hidden', hidden: true }],
  });

  assert.deepEqual(await provider.getSupportedModels(), {
    OPTIONS: [{
      value: 'gpt-live',
      label: 'GPT Live',
      description: 'Selected runtime model',
      isDefault: true,
      effort: {
        default: 'medium',
        values: [
          { value: 'medium', description: 'Balanced' },
          { value: 'high', description: 'Deep' },
        ],
      },
    }],
    DEFAULT: 'gpt-live',
    source: 'live',
  });
});

test('Codex models label the CLI cache stale when the live runtime read fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-models-'));
  const cachePath = path.join(root, 'models_cache.json');
  await writeFile(cachePath, JSON.stringify({
    models: [{
      slug: 'gpt-cached',
      display_name: 'GPT Cached',
      description: 'Cached catalog',
      priority: 1,
      visibility: 'list',
      supported_in_api: true,
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'high', description: 'Deep' }],
    }],
  }), 'utf8');
  const provider = new CodexProviderModels({
    readLiveModels: async () => { throw new Error('offline'); },
    modelsCachePath: cachePath,
  });

  try {
    const models = await provider.getSupportedModels();
    assert.equal(models.source, 'stale');
    assert.equal(models.DEFAULT, 'gpt-cached');
    assert.equal(models.OPTIONS[0]?.value, 'gpt-cached');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex models label the hardcoded catalog as fallback', async () => {
  const provider = new CodexProviderModels({
    readLiveModels: async () => { throw new Error('offline'); },
    modelsCachePath: path.join(os.tmpdir(), `missing-codex-models-${Date.now()}.json`),
  });
  assert.deepEqual(await provider.getSupportedModels(), CODEX_FALLBACK_MODELS);
  assert.equal((await provider.getSupportedModels()).source, 'fallback');
});
