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

test('1M models keep their full window minus the 20k reply reserve', () => {
  // window 1e6 falls through the 200k model-default clamp; maxOutput 64000
  // reserves only the 20000 cap.
  assert.equal(ceiling({ model: 'claude-opus-5' }), 980_000);
  assert.equal(ceiling({ model: 'claude-sonnet-5' }), 980_000);
  assert.equal(ceiling({ model: 'claude-fable-5' }), 980_000);
  assert.equal(ceiling({ model: 'claude-opus-4-7' }), 980_000);
});

test('200K models clamp to 200k and reserve the full 20k', () => {
  assert.equal(ceiling({ model: 'claude-haiku-4-5' }), 180_000);
  assert.equal(ceiling({ model: 'claude-sonnet-4-6' }), 180_000);
  assert.equal(ceiling({ model: 'claude-opus-4-6' }), 180_000);
});

test('a model whose max output is below the reserve cap reserves only that much', () => {
  // claude-3-5-haiku has no context block at all -> model-default clamp,
  // and max_output_tokens.default is 8192.
  assert.equal(ceiling({ model: 'claude-3-5-haiku' }), 200_000 - 8192);
});

test('floating picker aliases resolve to the model they currently point at', () => {
  assert.equal(ceiling({ model: 'opus' }), 980_000);
  assert.equal(ceiling({ model: 'sonnet' }), 980_000);
  assert.equal(ceiling({ model: 'fable' }), 980_000);
  assert.equal(ceiling({ model: 'haiku' }), 180_000);
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

  assert.equal(ceiling({ model: 'claude-opus-4-1-20250805' }), 180_000);
  assert.equal(ceiling({ model: 'us.anthropic.claude-opus-5' }), 980_000);
});

test('the [1m] suffix lifts a 200K model to the long-context window', () => {
  assert.deepEqual(normalizeClaudeModelId('sonnet[1m]'), {
    id: 'claude-sonnet-5',
    wantsLongContext: true,
  });
  // claude-sonnet-4-5 declares supports_1m_beta/suffix, so the suffix applies
  // and the 200k clamp no longer does.
  assert.equal(ceiling({ model: 'claude-sonnet-4-5[1m]' }), 980_000);
  // Already-1M models are unchanged by the suffix.
  assert.equal(ceiling({ model: 'opus[1m]' }), 980_000);
});

test('the [1m] suffix is ignored for a model that cannot do 1M', () => {
  assert.equal(ceiling({ model: 'claude-3-7-sonnet[1m]' }), 200_000 - 20_000);
});

test('unknown and default-valued models fall back to the 200K assumption', () => {
  assert.equal(resolveClaudeModelContextSpec('default'), null);
  assert.equal(resolveClaudeModelContextSpec('Default (recommended)'), null);
  assert.equal(ceiling({ model: 'default' }), 180_000);
  assert.equal(ceiling({ model: 'claude-opus-9' }), 180_000);
  assert.equal(ceiling({ model: '<synthetic>' }), 180_000);
  assert.equal(ceiling({}), 180_000);
});

test('SDK-supplied window and reply budget outrank the local table', () => {
  // A model the table has never seen, described by the stream's ModelUsage.
  assert.equal(
    ceiling({ model: 'claude-unicorn-9', contextWindow: 2_000_000, maxOutputTokens: 128_000 }),
    1_980_000,
  );
  // A sub-1M SDK window is still subject to the model-default clamp, exactly
  // as Claude Code applies it: 400k -> 200k, then the model's own 4k reserve.
  assert.equal(
    ceiling({ model: 'claude-unicorn-9', contextWindow: 400_000, maxOutputTokens: 4_000 }),
    196_000,
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
        280_000,
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
    assert.equal(ceiling({ model: 'claude-opus-5', settingsPath }), 480_000);

    // A cap wider than the model's own window cannot widen it.
    await writeFile(settingsPath, JSON.stringify({ autoCompactWindow: 900000 }), 'utf8');
    assert.equal(ceiling({ model: 'claude-haiku-4-5', settingsPath }), 180_000);

    // Junk in the settings file is ignored, not fatal.
    await writeFile(settingsPath, '{ not json', 'utf8');
    assert.equal(ceiling({ model: 'claude-opus-5', settingsPath }), 980_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
