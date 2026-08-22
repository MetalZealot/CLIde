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
import type { SessionModelPickStore } from '@/modules/providers/services/provider-session-model.service.js';

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

test('Codex reads each session model from that session rollout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-session-models-'));
  const firstPath = path.join(root, 'first.jsonl');
  const secondPath = path.join(root, 'second.jsonl');
  await writeFile(firstPath, [
    JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-08-21T20:00:00.000Z',
      payload: { model: 'gpt-5.4', effort: 'high' },
    }),
    '{"type":"turn_context"',
  ].join('\n'), 'utf8');
  await writeFile(secondPath, JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-08-21T20:01:00.000Z',
    payload: { model: 'gpt-5.6-sol', effort: 'high' },
  }), 'utf8');

  const provider = new CodexProviderModels({
    lookupSessionRow: (sessionId) => ({
      jsonl_path: sessionId === 'session-a' ? firstPath : secondPath,
    }),
  });

  try {
    assert.deepEqual(await provider.getCurrentActiveModel('session-a'), {
      model: 'gpt-5.4',
      source: 'transcript',
    });
    assert.deepEqual(await provider.getCurrentActiveModel('session-b'), {
      model: 'gpt-5.6-sol',
      source: 'transcript',
    });
    assert.equal(
      await provider.getTranscriptTurnTimestamp('session-b'),
      '2026-08-21T20:01:00.000Z',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex uses a newer session pick but keeps a newer rollout turn as truth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-model-precedence-'));
  const rolloutPath = path.join(root, 'session.jsonl');
  await writeFile(rolloutPath, JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-08-21T20:00:00.000Z',
    payload: { model: 'gpt-5.6-sol' },
  }), 'utf8');

  const picks = new Map([
    ['newer-pick', { model: 'gpt-5.4', updatedAt: '2026-08-21T20:01:00.000Z' }],
    ['older-pick', { model: 'gpt-5.4', updatedAt: '2026-08-21T19:59:00.000Z' }],
  ]);
  const modelPickStore: SessionModelPickStore = {
    getSessionModelPick: (sessionId) => picks.get(sessionId) ?? null,
    setSessionModelPick: () => true,
  };
  const provider = new CodexProviderModels({
    modelPickStore,
    lookupSessionRow: () => ({ jsonl_path: rolloutPath }),
  });

  try {
    assert.deepEqual(await provider.getCurrentActiveModel('newer-pick'), {
      model: 'gpt-5.4',
      source: 'pick',
    });
    assert.deepEqual(await provider.getCurrentActiveModel('older-pick'), {
      model: 'gpt-5.6-sol',
      source: 'transcript',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
