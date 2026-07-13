import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLAUDE_FALLBACK_MODELS,
  ClaudeProviderModels,
  resolveClaudeModelAlias,
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { writeProviderSessionActiveModelChange } from '@/shared/utils.js';

const APP_SESSION_ID = '011a8bc9-ad89-42fd-96c2-c8ac5ef4f999';
const PROVIDER_SESSION_ID = '77af7791-311d-4f0e-abbf-381f25ed775a';

const withTempDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-models-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const writeSessionJsonl = async (dir: string, model: string): Promise<string> => {
  const jsonlPath = path.join(dir, `${PROVIDER_SESSION_ID}.jsonl`);
  const lines = [
    { type: 'user', sessionId: PROVIDER_SESSION_ID, message: { content: 'hello' } },
    { type: 'assistant', sessionId: PROVIDER_SESSION_ID, message: { model, content: [] } },
  ];
  await writeFile(jsonlPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return jsonlPath;
};

test('claude current active model returns a picker-selected session model immediately', async () => {
  await withTempDir(async (dir) => {
    const changesPath = path.join(dir, 'changes.json');
    await writeProviderSessionActiveModelChange(
      'claude',
      { sessionId: APP_SESSION_ID, model: 'fable' },
      { filePath: changesPath },
    );

    const provider = new ClaudeProviderModels({
      getSessionRow: () => null,
      activeModelChangesPath: changesPath,
    });

    const active = await provider.getCurrentActiveModel(APP_SESSION_ID);
    assert.equal(active.model, 'fable');
  });
});

test('claude current active model matches transcript events by the provider session id', async () => {
  await withTempDir(async (dir) => {
    const jsonlPath = await writeSessionJsonl(dir, 'claude-fable-5');

    const provider = new ClaudeProviderModels({
      getSessionRow: (sessionId) =>
        sessionId === APP_SESSION_ID
          ? { provider_session_id: PROVIDER_SESSION_ID, jsonl_path: jsonlPath }
          : null,
      activeModelChangesPath: path.join(dir, 'missing-changes.json'),
    });

    const active = await provider.getCurrentActiveModel(APP_SESSION_ID);
    assert.equal(active.model, 'fable');
  });
});

test('claude current active model falls back to the catalog default without session data', async () => {
  await withTempDir(async (dir) => {
    const provider = new ClaudeProviderModels({
      getSessionRow: () => null,
      activeModelChangesPath: path.join(dir, 'missing-changes.json'),
    });

    const active = await provider.getCurrentActiveModel(APP_SESSION_ID);
    assert.equal(active.model, CLAUDE_FALLBACK_MODELS.DEFAULT);
  });
});

const findDefaultOption = (options: { value: string; description?: string }[]) => {
  const option = options.find((candidate) => candidate.value === 'default');
  assert.ok(option, 'catalog should contain a default option');
  return option;
};

test('claude default option description reports the model configured in claude settings', async () => {
  await withTempDir(async (dir) => {
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ model: 'claude-fable-5[1m]' }), 'utf8');

    const provider = new ClaudeProviderModels({ claudeSettingsPath: settingsPath });
    const models = await provider.getSupportedModels();

    const defaultOption = findDefaultOption(models.OPTIONS);
    assert.match(defaultOption.description ?? '', /claude-fable-5\[1m\]/);
    assert.doesNotMatch(defaultOption.description ?? '', /Sonnet 5/);
  });
});

test('claude default option description stays neutral when no default model is configured', async () => {
  await withTempDir(async (dir) => {
    const provider = new ClaudeProviderModels({
      claudeSettingsPath: path.join(dir, 'missing-settings.json'),
    });
    const models = await provider.getSupportedModels();

    const defaultOption = findDefaultOption(models.OPTIONS);
    assert.doesNotMatch(defaultOption.description ?? '', /Sonnet 5/);
    assert.match(defaultOption.description ?? '', /Claude Code default model/);
  });
});

test('claude default option description prefers the ANTHROPIC_MODEL env override', async () => {
  await withTempDir(async (dir) => {
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ model: 'claude-fable-5[1m]' }), 'utf8');

    const previousEnv = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    try {
      const provider = new ClaudeProviderModels({ claudeSettingsPath: settingsPath });
      const models = await provider.getSupportedModels();

      const defaultOption = findDefaultOption(models.OPTIONS);
      assert.match(defaultOption.description ?? '', /claude-opus-4-8/);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.ANTHROPIC_MODEL;
      } else {
        process.env.ANTHROPIC_MODEL = previousEnv;
      }
    }
  });
});

test('claude supported models lookup does not mutate the shared fallback catalog', async () => {
  await withTempDir(async (dir) => {
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ model: 'claude-fable-5[1m]' }), 'utf8');

    const provider = new ClaudeProviderModels({ claudeSettingsPath: settingsPath });
    await provider.getSupportedModels();

    const fallbackDefault = findDefaultOption(CLAUDE_FALLBACK_MODELS.OPTIONS);
    assert.doesNotMatch(fallbackDefault.description ?? '', /claude-fable-5/);
  });
});

test('claude model aliases resolve from full model ids', () => {
  const options = CLAUDE_FALLBACK_MODELS.OPTIONS;

  assert.equal(resolveClaudeModelAlias('claude-fable-5', options), 'fable');
  assert.equal(resolveClaudeModelAlias('claude-opus-4-8', options), 'opus');
  assert.equal(resolveClaudeModelAlias('claude-haiku-4-5-20251001', options), 'haiku');
  assert.equal(resolveClaudeModelAlias('claude-sonnet-5[1m]', options), 'sonnet[1m]');
  // Values that already are picker aliases pass through unchanged.
  assert.equal(resolveClaudeModelAlias('opus', options), 'opus');
  // Unknown ids are surfaced as-is rather than hidden behind the default.
  assert.equal(resolveClaudeModelAlias('claude-zeta-9', options), 'claude-zeta-9');
});
