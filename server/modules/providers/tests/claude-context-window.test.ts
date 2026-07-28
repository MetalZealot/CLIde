import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeClaudeModelId,
  resetClaudeContextWindowCache,
  resolveClaudeContextCeiling,
  resolveClaudeModelContextSpec,
} from '@/modules/providers/list/claude/claude-context-window.js';

// Every case runs against a settings.json that does not exist, so the
// model-default clamp is the only cap in play unless a test says otherwise.
const NO_SETTINGS = path.join(os.tmpdir(), 'clide-missing-claude-settings', 'settings.json');

const withoutEnv = (keys: string[], run: () => void): void => {
  const saved = keys.map((key) => [key, process.env[key]] as const);
  for (const key of keys) {
    delete process.env[key];
  }
  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const ceiling = (input: Parameters<typeof resolveClaudeContextCeiling>[0] = {}): number => {
  let result = 0;
  withoutEnv(['CONTEXT_WINDOW', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'], () => {
    resetClaudeContextWindowCache();
    result = resolveClaudeContextCeiling({ settingsPath: NO_SETTINGS, ...input });
  });
  return result;
};

test('1M models keep their full window minus the 33k long-context reserve', () => {
  // window 1e6 falls through the 200k model-default clamp, then gives up the
  // 33000 the SDK was measured holding back (see LONG_CONTEXT_RESERVE).
  assert.equal(ceiling({ model: 'claude-opus-5' }), 967_000);
  assert.equal(ceiling({ model: 'claude-sonnet-5' }), 967_000);
  assert.equal(ceiling({ model: 'claude-fable-5' }), 967_000);
  assert.equal(ceiling({ model: 'claude-opus-4-7' }), 967_000);
});

test('200K models clamp to 200k with no reserve held back', () => {
  // Measured: the SDK reports maxTokens 200000 for claude-haiku-4-5, i.e. the
  // full window. The reserve only applies to the 1M models.
  assert.equal(ceiling({ model: 'claude-haiku-4-5' }), 200_000);
  assert.equal(ceiling({ model: 'claude-sonnet-4-6' }), 200_000);
  assert.equal(ceiling({ model: 'claude-opus-4-6' }), 200_000);
});

test('a pre-4 model with no context block falls back to the model default', () => {
  // claude-3-5-haiku has no context block at all -> model-default clamp.
  assert.equal(ceiling({ model: 'claude-3-5-haiku' }), 200_000);
});

test('floating picker aliases resolve to the model they currently point at', () => {
  assert.equal(ceiling({ model: 'opus' }), 967_000);
  assert.equal(ceiling({ model: 'sonnet' }), 967_000);
  assert.equal(ceiling({ model: 'fable' }), 967_000);
  assert.equal(ceiling({ model: 'haiku' }), 200_000);
});

test('dated and provider-qualified wire ids resolve to their registry entry', () => {
  assert.equal(normalizeClaudeModelId('claude-opus-4-1-20250805').id, 'claude-opus-4-1');
  assert.equal(normalizeClaudeModelId('claude-haiku-4-5-20251001').id, 'claude-haiku-4-5');
  assert.equal(normalizeClaudeModelId('us.anthropic.claude-opus-5').id, 'claude-opus-5');
  assert.equal(normalizeClaudeModelId('us.anthropic.claude-haiku-4-5-20251001-v1:0').id, 'claude-haiku-4-5');
  assert.equal(normalizeClaudeModelId('claude-sonnet-4-5@20250929').id, 'claude-sonnet-4-5');
  assert.equal(normalizeClaudeModelId('claude-3-5-sonnet-v2@20241022').id, 'claude-3-5-sonnet');
  // Opus 4 / Sonnet 4 date-strip to a stem that is not their registry id.
  assert.equal(normalizeClaudeModelId('claude-opus-4-20250514').id, 'claude-opus-4-0');
  assert.equal(normalizeClaudeModelId('claude-sonnet-4-20250514').id, 'claude-sonnet-4-0');

  assert.equal(ceiling({ model: 'claude-opus-4-1-20250805' }), 200_000);
  assert.equal(ceiling({ model: 'us.anthropic.claude-opus-5' }), 967_000);
});

test('the [1m] suffix lifts a 200K model to the long-context window', () => {
  assert.deepEqual(normalizeClaudeModelId('sonnet[1m]'), {
    id: 'claude-sonnet-5',
    wantsLongContext: true,
  });
  // claude-sonnet-4-5 declares supports_1m_beta/suffix, so the suffix applies
  // and the 200k clamp no longer does.
  assert.equal(ceiling({ model: 'claude-sonnet-4-5[1m]' }), 967_000);
  // Already-1M models are unchanged by the suffix.
  assert.equal(ceiling({ model: 'opus[1m]' }), 967_000);
});

test('the [1m] suffix is ignored for a model that cannot do 1M', () => {
  assert.equal(ceiling({ model: 'claude-3-7-sonnet[1m]' }), 200_000);
});

test('unknown and default-valued models fall back to the 200K assumption', () => {
  assert.equal(resolveClaudeModelContextSpec('default'), null);
  assert.equal(resolveClaudeModelContextSpec('Default (recommended)'), null);
  assert.equal(ceiling({ model: 'default' }), 200_000);
  assert.equal(ceiling({ model: 'claude-opus-9' }), 200_000);
  assert.equal(ceiling({ model: '<synthetic>' }), 200_000);
  assert.equal(ceiling({}), 200_000);
});

test('an SDK-supplied window outranks the local table', () => {
  // A model the table has never seen, described by the stream's ModelUsage.
  assert.equal(
    ceiling({ model: 'claude-unicorn-9', contextWindow: 2_000_000 }),
    1_967_000,
  );
  // A sub-1M SDK window is still subject to the model-default clamp, exactly
  // as Claude Code applies it: 400k -> 200k.
  assert.equal(
    ceiling({ model: 'claude-unicorn-9', contextWindow: 400_000 }),
    200_000,
  );
});

test('CONTEXT_WINDOW stays an absolute operator override', () => {
  withoutEnv(['CLAUDE_CODE_AUTO_COMPACT_WINDOW'], () => {
    const saved = process.env.CONTEXT_WINDOW;
    process.env.CONTEXT_WINDOW = '160000';
    try {
      resetClaudeContextWindowCache();
      assert.equal(
        resolveClaudeContextCeiling({ model: 'claude-opus-5', settingsPath: NO_SETTINGS }),
        160_000,
      );
    } finally {
      if (saved === undefined) {
        delete process.env.CONTEXT_WINDOW;
      } else {
        process.env.CONTEXT_WINDOW = saved;
      }
    }
  });
});

test('CLAUDE_CODE_AUTO_COMPACT_WINDOW caps the window before the reserve', () => {
  withoutEnv(['CONTEXT_WINDOW'], () => {
    const saved = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '300000';
    try {
      resetClaudeContextWindowCache();
      assert.equal(
        resolveClaudeContextCeiling({ model: 'claude-opus-5', settingsPath: NO_SETTINGS }),
        300_000,
      );
    } finally {
      if (saved === undefined) {
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      } else {
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = saved;
      }
    }
  });
});

test('settings.json autoCompactWindow caps the window when no env cap is set', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-context-window-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  try {
    await writeFile(settingsPath, JSON.stringify({ autoCompactWindow: 500000 }), 'utf8');
    assert.equal(ceiling({ model: 'claude-opus-5', settingsPath }), 500_000);

    // A cap wider than the model's own window cannot widen it.
    await writeFile(settingsPath, JSON.stringify({ autoCompactWindow: 900000 }), 'utf8');
    assert.equal(ceiling({ model: 'claude-haiku-4-5', settingsPath }), 200_000);

    // Junk in the settings file is ignored, not fatal.
    await writeFile(settingsPath, '{ not json', 'utf8');
    assert.equal(ceiling({ model: 'claude-opus-5', settingsPath }), 967_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
