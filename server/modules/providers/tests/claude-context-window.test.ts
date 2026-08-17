import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLAUDE_MODEL_CONTEXT_SPECS,
  CLAUDE_MODEL_ID_ALIASES,
  normalizeClaudeModelId,
  resetClaudeContextWindowCache,
  resolveClaudeContextCeiling,
  resolveClaudeModelContextSpec,
} from '@/modules/providers/list/claude/claude-context-window.js';
import {
  parseClaudeRuntimeVersion,
  readClaudeSdkVersion,
  recordClaudeVersionPair,
} from '@/modules/providers/list/claude/claude-version-pair.js';

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
  withoutEnv(['CONTEXT_WINDOW', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_1M_CONTEXT'], () => {
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

test('CLAUDE_CODE_DISABLE_1M_CONTEXT holds every model to the default window', () => {
  const disabled = (model: string, contextWindow?: number): number => {
    let result = 0;
    withoutEnv(['CONTEXT_WINDOW', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'], () => {
      const saved = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = 'true';
      try {
        resetClaudeContextWindowCache();
        result = resolveClaudeContextCeiling({ model, contextWindow, settingsPath: NO_SETTINGS });
      } finally {
        if (saved === undefined) {
          delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
        } else {
          process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = saved;
        }
      }
    });
    return result;
  };

  // Native 1M, the [1m] suffix, and an SDK-reported 1M window all collapse to
  // 200k with no reserve — the runtime fails all three paths while this is set.
  assert.equal(disabled('claude-opus-5'), 200_000);
  assert.equal(disabled('claude-sonnet-4-5[1m]'), 200_000);
  assert.equal(disabled('claude-unicorn-9', 2_000_000), 200_000);
  assert.equal(disabled('claude-haiku-4-5'), 200_000);
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

// The specs above are transcribed by hand from the SDK's model registry, so a
// bumped SDK can invalidate them silently. Re-parse the installed bundle and
// diff, rather than trusting the header comment's "refresh this" instruction.

type RegistryEntry = {
  window: number | null;
  maxOutputTokens: number;
  supportsLongContext: boolean;
};

const readSdkRegistry = (): { models: Record<string, RegistryEntry>; aliases: Record<string, string> } => {
  const sdkPath = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  const bundle = readFileSync(sdkPath, 'utf8');

  const modelsStart = bundle.indexOf('models:[{id:"claude-');
  const aliasesStart = bundle.indexOf('],aliases:{', modelsStart);
  const aliasesEnd = bundle.indexOf(',defaults:', aliasesStart);
  assert.ok(
    modelsStart >= 0 && aliasesStart > modelsStart && aliasesEnd > aliasesStart,
    'model registry not found in sdk.mjs; the parser below needs updating, not deleting',
  );

  const modelsBlock = bundle.slice(modelsStart, aliasesStart);
  const ids = [...modelsBlock.matchAll(/id:"(claude-[a-z0-9.-]+)",family:"/g)];
  const models: Record<string, RegistryEntry> = {};

  ids.forEach((match, index) => {
    // Minified entries carry no separator of their own, so bound each at the next
    // id; an unbounded slice reads the following entry's fields.
    const entry = modelsBlock.slice(match.index, ids[index + 1]?.index ?? modelsBlock.length);
    const context = /context:\{([^}]*)\}/.exec(entry)?.[1];
    const window = context ? /window:([0-9e.+]+)/.exec(context)?.[1] : undefined;
    const maxOutputTokens = /max_output_tokens:\{default:([0-9]+)/.exec(entry)?.[1];
    assert.ok(maxOutputTokens, `no max_output_tokens parsed for ${match[1]}`);

    models[match[1]] = {
      window: window === undefined ? null : Number(window),
      maxOutputTokens: Number(maxOutputTokens),
      supportsLongContext: context
        ? /native_1m:!0|supports_1m_beta:!0|supports_1m_suffix:!0/.test(context)
        : false,
    };
  });

  const aliasEntries = [
    ...bundle.slice(aliasesStart, aliasesEnd).matchAll(/([a-z0-9_]+):\{default:"([^"]+)"/g),
  ];
  return { models, aliases: Object.fromEntries(aliasEntries.map((m) => [m[1], m[2]])) };
};

test('CLAUDE_MODEL_CONTEXT_SPECS matches the installed SDK model registry', () => {
  const { models } = readSdkRegistry();

  // A parser that silently matched nothing would make this test vacuous.
  assert.ok(Object.keys(models).length >= 10, `parsed only ${Object.keys(models).length} registry entries`);

  const recorded = Object.fromEntries(
    Object.entries(CLAUDE_MODEL_CONTEXT_SPECS).map(([id, spec]) => [
      id,
      {
        window: spec.window ?? null,
        maxOutputTokens: spec.maxOutputTokens,
        supportsLongContext: spec.supportsLongContext,
      },
    ]),
  );

  // One diff covers drifted values, models added to the registry, and specs left
  // behind for models it has dropped.
  assert.deepEqual(recorded, models);
});

test('CLAUDE_MODEL_ID_ALIASES matches the registry aliases block', () => {
  const { models, aliases } = readSdkRegistry();

  assert.ok(Object.keys(aliases).length > 0, 'parsed no registry aliases');
  for (const [name, target] of Object.entries(aliases)) {
    assert.equal(CLAUDE_MODEL_ID_ALIASES[name], target, `registry alias "${name}" now points at ${target}`);
  }

  // CLIde carries aliases the registry has none for: a family with no alias
  // entry, and the two dated wire ids whose stem is not the registry id. They
  // are deliberate, but must still resolve to a model that exists.
  for (const [name, target] of Object.entries(CLAUDE_MODEL_ID_ALIASES)) {
    assert.ok(target in models, `alias "${name}" points at ${target}, which the registry no longer lists`);
  }
});

// The runtime on PATH self-updates on its own schedule, so the pair it forms
// with the pinned SDK is recorded rather than asserted.

test('parseClaudeRuntimeVersion reads the version out of --version output', () => {
  assert.equal(parseClaudeRuntimeVersion('2.1.233 (Claude Code)\n'), '2.1.233');
  assert.equal(parseClaudeRuntimeVersion('2.2.0-rc.1 (Claude Code)'), '2.2.0-rc.1');
  assert.equal(parseClaudeRuntimeVersion('command not found'), null);
  assert.equal(parseClaudeRuntimeVersion(''), null);
});

test('readClaudeSdkVersion reports the installed SDK', () => {
  const version = readClaudeSdkVersion();
  assert.match(String(version), /^\d+\.\d+\.\d+/);
});

test('the version pair is written once and rewritten only when it moves', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-version-pair-test-'));
  const storePath = path.join(dir, 'claude-version-pair.json');
  try {
    const first = recordClaudeVersionPair({ sdk: '0.3.233', runtime: '2.1.233' }, storePath);
    assert.equal(first.drift, null, 'a first observation has nothing to drift from');
    assert.equal(first.record.previous, undefined);

    // An unchanged pair must not rewrite the file — this runs on every auth poll.
    const repeat = recordClaudeVersionPair({ sdk: '0.3.233', runtime: '2.1.233' }, storePath);
    assert.equal(repeat.drift, null);
    assert.equal(repeat.record.observedAt, first.record.observedAt);

    const moved = recordClaudeVersionPair({ sdk: '0.3.233', runtime: '2.1.240' }, storePath);
    assert.equal(moved.drift, 'Claude Code runtime 2.1.233 -> 2.1.240');
    assert.deepEqual(moved.record.previous, {
      sdk: '0.3.233',
      runtime: '2.1.233',
      observedAt: first.record.observedAt,
    });

    // Both halves can move at once, and the stored record is what is compared.
    const bumped = recordClaudeVersionPair({ sdk: '0.3.240', runtime: '2.1.241' }, storePath);
    assert.equal(
      bumped.drift,
      'Claude Code runtime 2.1.240 -> 2.1.241; Agent SDK 0.3.233 -> 0.3.240',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
