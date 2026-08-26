import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { readClaudeAutoCompactSettings, writeClaudeAutoCompactSettings } from '@/modules/providers/list/claude/claude-autocompact.settings.js';
import {
  captureClaudeContextUsage,
  clearClaudeContextCeilings,
  getClaudeContextCeiling,
  loadClaudeContextCeiling,
  parseClaudeContextUsage,
  rememberClaudeContextCeiling,
} from '@/modules/providers/list/claude/claude-context-usage.js';
import {
  CLAUDE_MODEL_CONTEXT_SPECS,
  CLAUDE_MODEL_ID_ALIASES,
  normalizeClaudeModelId,
  resetClaudeContextWindowCache,
  resolveClaudeCeilingProvenance,
  resolveClaudeContextCeiling,
  resolveClaudeDerivedCeiling,
  resolveClaudeModelContextSpec,
} from '@/modules/providers/list/claude/claude-context-window.js';
import { parseClaudeRuntimeVersion, readClaudeSdkVersion, recordClaudeVersionPair } from '@/modules/providers/list/claude/claude-version-pair.js';

describe('claude-context-usage', () => {
  // Trimmed from a real getContextUsage() response — see the FINDINGS block in
  // scripts/verify-context-usage-sdk.ts (claude-sonnet-5, SDK 0.3.220).
  const SONNET_PAYLOAD = {
    totalTokens: 26878,
    maxTokens: 967000,
    rawMaxTokens: 967000,
    percentage: 3,
    model: 'claude-sonnet-5',
    autoCompactThreshold: 934000,
    isAutoCompactEnabled: true,
    categories: [
      { name: 'System prompt', tokens: 8835, color: 'blue' },
      { name: 'System tools (deferred)', tokens: 15380, color: 'cyan', isDeferred: true },
      { name: 'Autocompact buffer', tokens: 33000, color: 'gray' },
      { name: 'Free space', tokens: 907122, color: 'gray' },
    ],
    memoryFiles: [{ path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 2195 }],
    mcpTools: [{ name: 'search_files', serverName: 'gdrive', tokens: 420, isLoaded: true }],
    systemTools: [{ name: 'Bash', tokens: 1200 }],
    systemPromptSections: [{ name: 'Tone and style', tokens: 300 }],
    agents: [{ agentType: 'Explore', source: 'builtin', tokens: 223 }],
    skills: { totalSkills: 14, includedSkills: 14, tokens: 1739 },
    slashCommands: { totalCommands: 20, includedCommands: 20, tokens: 640 },
    messageBreakdown: {
      toolCallTokens: 0,
      toolResultTokens: 0,
      attachmentTokens: 2198,
      assistantMessageTokens: 7,
      userMessageTokens: 18,
      redirectedContextTokens: 0,
      unattributedTokens: 820,
      toolCallsByType: [],
      attachmentsByType: [{ name: 'skill_listing', tokens: 1403 }],
    },
  };

  test('parses the fields the ring needs off a real payload', () => {
    const parsed = parseClaudeContextUsage(SONNET_PAYLOAD);
    assert.ok(parsed);
    assert.equal(parsed.maxTokens, 967_000);
    assert.equal(parsed.autoCompactThreshold, 934_000);
    assert.equal(parsed.isAutoCompactEnabled, true);
    assert.equal(parsed.model, 'claude-sonnet-5');
    assert.equal(parsed.totalTokens, 26_878);
    assert.ok(parsed.fetchedAt > 0);
  });

  test('reshapes the /context breakdown', () => {
    const breakdown = parseClaudeContextUsage(SONNET_PAYLOAD)?.breakdown;
    assert.ok(breakdown);

    assert.equal(breakdown.categories.length, 4);
    assert.deepEqual(breakdown.categories[1], {
      name: 'System tools (deferred)',
      tokens: 15_380,
      color: 'cyan',
      isDeferred: true,
    });
    assert.equal(breakdown.memoryFiles[0].path, '/home/u/.claude/CLAUDE.md');
    assert.equal(breakdown.mcpTools[0].serverName, 'gdrive');
    assert.deepEqual(breakdown.systemTools, [{ name: 'Bash', tokens: 1200 }]);
    assert.deepEqual(breakdown.systemPromptSections, [{ name: 'Tone and style', tokens: 300 }]);
    // agentType is renamed to a plain `name` so the modal renders every section
    // through one shape.
    assert.deepEqual(breakdown.agents, [{ name: 'Explore', source: 'builtin', tokens: 223 }]);
    assert.equal(breakdown.skills?.includedSkills, 14);
    assert.equal(breakdown.slashCommands?.totalCommands, 20);
    assert.equal(breakdown.messageBreakdown?.unattributedTokens, 820);
    assert.deepEqual(breakdown.messageBreakdown?.attachmentsByType, [
      { name: 'skill_listing', tokens: 1403 },
    ]);
  });

  test('a payload missing every optional section still parses', () => {
    // An older CLI, or a session with no MCP servers, skills or agents. The
    // modal has to render something rather than throw on a missing array.
    const parsed = parseClaudeContextUsage({ maxTokens: 200000, isAutoCompactEnabled: false });
    assert.equal(parsed?.breakdown?.categories.length, 0);
    assert.equal(parsed?.breakdown?.memoryFiles.length, 0);
    assert.equal(parsed?.breakdown?.mcpTools.length, 0);
    assert.equal(parsed?.breakdown?.agents.length, 0);
    assert.equal(parsed?.breakdown?.skills, undefined);
    assert.equal(parsed?.breakdown?.messageBreakdown, undefined);
    assert.equal(parsed?.percentage, undefined);
  });

  test('junk inside a breakdown section is dropped, not rendered', () => {
    const parsed = parseClaudeContextUsage({
      maxTokens: 200000,
      isAutoCompactEnabled: true,
      categories: [null, 'nope', { name: 'Real', tokens: 10 }, { tokens: 'lots' }],
      systemTools: 'not-an-array',
    });

    assert.equal(parsed?.breakdown?.categories.length, 2);
    assert.deepEqual(parsed?.breakdown?.categories[0], {
      name: 'Real',
      tokens: 10,
      color: undefined,
      isDeferred: false,
    });
    // A nameless, uncountable entry degrades instead of breaking the list.
    assert.deepEqual(parsed?.breakdown?.categories[1], {
      name: 'Unknown',
      tokens: 0,
      color: undefined,
      isDeferred: false,
    });
    assert.deepEqual(parsed?.breakdown?.systemTools, []);
  });

  test('falls back to rawMaxTokens when maxTokens is missing', () => {
    const parsed = parseClaudeContextUsage({ rawMaxTokens: 200000, isAutoCompactEnabled: false });
    assert.equal(parsed?.maxTokens, 200_000);
    assert.equal(parsed?.isAutoCompactEnabled, false);
    assert.equal(parsed?.autoCompactThreshold, undefined);
  });

  test('rejects payloads with no usable ceiling', () => {
    // A zero denominator would blank the ring, so these must degrade to the
    // derived fallback rather than being cached.
    assert.equal(parseClaudeContextUsage(null), null);
    assert.equal(parseClaudeContextUsage('nope'), null);
    assert.equal(parseClaudeContextUsage({}), null);
    assert.equal(parseClaudeContextUsage({ maxTokens: 0 }), null);
    assert.equal(parseClaudeContextUsage({ maxTokens: -5 }), null);
    assert.equal(parseClaudeContextUsage({ maxTokens: 'lots' }), null);
  });

  test('remembers a ceiling per session and ignores a missing session id', () => {
    clearClaudeContextCeilings();
    const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

    rememberClaudeContextCeiling('session-a', ceiling);
    rememberClaudeContextCeiling(null, ceiling);
    rememberClaudeContextCeiling(undefined, ceiling);

    assert.equal(getClaudeContextCeiling('session-a')?.maxTokens, 967_000);
    assert.equal(getClaudeContextCeiling('session-b'), null);
    assert.equal(getClaudeContextCeiling(null), null);
  });

  test('evicts the least recently written session past the cap', () => {
    clearClaudeContextCeilings();
    const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

    // 200 is the cap; writing 250 must not grow without bound.
    for (let i = 0; i < 250; i += 1) {
      rememberClaudeContextCeiling(`session-${i}`, ceiling);
    }

    assert.equal(getClaudeContextCeiling('session-0'), null);
    assert.equal(getClaudeContextCeiling('session-49'), null);
    assert.ok(getClaudeContextCeiling('session-50'));
    assert.ok(getClaudeContextCeiling('session-249'));
  });

  test('re-writing a session keeps it from being evicted as stale', () => {
    clearClaudeContextCeilings();
    const ceiling = parseClaudeContextUsage(SONNET_PAYLOAD)!;

    rememberClaudeContextCeiling('long-lived', ceiling);
    for (let i = 0; i < 150; i += 1) {
      rememberClaudeContextCeiling(`filler-${i}`, ceiling);
    }
    rememberClaudeContextCeiling('long-lived', ceiling);
    for (let i = 150; i < 300; i += 1) {
      rememberClaudeContextCeiling(`filler-${i}`, ceiling);
    }

    assert.ok(getClaudeContextCeiling('long-lived'));
  });

  test('captures a live reading into the cache', async () => {
    clearClaudeContextCeilings();
    const captured = await captureClaudeContextUsage('session-live', {
      getContextUsage: async () => SONNET_PAYLOAD,
    });

    assert.equal(captured?.maxTokens, 967_000);
    assert.equal(getClaudeContextCeiling('session-live')?.autoCompactThreshold, 934_000);
  });

  test('a failing control request is not an error for the ring', async () => {
    clearClaudeContextCeilings();

    // The two failures the probe actually hit, plus a CLI too old to answer.
    const closed = await captureClaudeContextUsage('session-closed', {
      getContextUsage: async () => {
        throw new Error('Query closed before response received');
      },
    });
    const notWritable = await captureClaudeContextUsage('session-dead', {
      getContextUsage: async () => {
        throw new Error('ProcessTransport is not ready for writing');
      },
    });
    const unsupported = await captureClaudeContextUsage('session-old', {});
    const noSession = await captureClaudeContextUsage(null, {
      getContextUsage: async () => SONNET_PAYLOAD,
    });

    assert.equal(closed, null);
    assert.equal(notWritable, null);
    assert.equal(unsupported, null);
    assert.equal(noSession, null);
    assert.equal(getClaudeContextCeiling('session-closed'), null);
    assert.equal(getClaudeContextCeiling('session-dead'), null);
  });

  test('a malformed live reading leaves the cache alone', async () => {
    clearClaudeContextCeilings();
    rememberClaudeContextCeiling('session-x', parseClaudeContextUsage(SONNET_PAYLOAD)!);

    const captured = await captureClaudeContextUsage('session-x', {
      getContextUsage: async () => ({ maxTokens: 'unknown' }),
    });

    assert.equal(captured, null);
    // The previous good reading survives rather than being replaced by junk.
    assert.equal(getClaudeContextCeiling('session-x')?.maxTokens, 967_000);
  });

  // --- Persistence -----------------------------------------------------------
  // The store follows DATABASE_PATH, so these point it at a temp directory and
  // leave the real one alone.

  const withTempStore = async (run: (storeDir: string) => Promise<void>): Promise<void> => {
    const previous = process.env.DATABASE_PATH;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clide-context-usage-'));
    process.env.DATABASE_PATH = path.join(root, 'auth.db');

    try {
      await run(path.join(root, 'context-usage'));
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_PATH;
      } else {
        process.env.DATABASE_PATH = previous;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  };

  /** Writes are fire-and-forget, so wait for the file rather than assuming it. */
  const waitForFile = async (filePath: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    return false;
  };

  test('a reading outlives the process that took it', async () => {
    await withTempStore(async (storeDir) => {
      clearClaudeContextCeilings();
      rememberClaudeContextCeiling('session-persist', parseClaudeContextUsage(SONNET_PAYLOAD)!);
      assert.ok(await waitForFile(path.join(storeDir, 'session-persist.json')));

      // Stands in for a restart: memory is empty, the file is not.
      clearClaudeContextCeilings();
      assert.equal(getClaudeContextCeiling('session-persist'), null);

      const restored = await loadClaudeContextCeiling('session-persist');
      assert.equal(restored?.maxTokens, 967_000);
      assert.equal(restored?.autoCompactThreshold, 934_000);
      assert.equal(restored?.isAutoCompactEnabled, true);
      assert.equal(restored?.model, 'claude-sonnet-5');
      // The breakdown is what /context renders, so it has to survive intact.
      assert.equal(restored?.breakdown?.categories.length, 4);
      assert.equal(restored?.breakdown?.memoryFiles[0]?.tokens, 2195);
      assert.equal(restored?.breakdown?.skills?.tokens, 1739);

      // A restored reading warms the map, so the next read stays in memory.
      assert.equal(getClaudeContextCeiling('session-persist')?.maxTokens, 967_000);
    });
  });

  test('a session with no reading on disk loads as null', async () => {
    await withTempStore(async () => {
      clearClaudeContextCeilings();
      assert.equal(await loadClaudeContextCeiling('session-never-ran'), null);
    });
  });

  test('an unreadable persisted reading degrades to the derived ceiling', async () => {
    await withTempStore(async (storeDir) => {
      clearClaudeContextCeilings();
      await fs.mkdir(storeDir, { recursive: true });
      await fs.writeFile(path.join(storeDir, 'session-truncated.json'), '{"version":1,"ceil');
      await fs.writeFile(
        path.join(storeDir, 'session-no-ceiling.json'),
        JSON.stringify({ version: 1, ceiling: { maxTokens: 0 } }),
      );

      // Null, not a throw and not a zero denominator — callers fall back.
      assert.equal(await loadClaudeContextCeiling('session-truncated'), null);
      assert.equal(await loadClaudeContextCeiling('session-no-ceiling'), null);
    });
  });

  test('a session id that cannot be a filename stays in memory only', async () => {
    await withTempStore(async (storeDir) => {
      clearClaudeContextCeilings();
      rememberClaudeContextCeiling('../escape', parseClaudeContextUsage(SONNET_PAYLOAD)!);

      // Usable in memory for this process...
      assert.equal(getClaudeContextCeiling('../escape')?.maxTokens, 967_000);

      // ...but nothing was written anywhere.
      clearClaudeContextCeilings();
      assert.equal(await loadClaudeContextCeiling('../escape'), null);
      const written = await fs.readdir(storeDir).catch(() => []);
      assert.deepEqual(written, []);
    });
  });
});

describe('claude-context-window', () => {
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

  test('provenance names the cap in force and the model window behind it', () => {
    withoutEnv(['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_1M_CONTEXT'], () => {
      resetClaudeContextWindowCache();
      // No settings file: nothing caps the window, which is what `auto` means.
      const auto = resolveClaudeCeilingProvenance({
        model: 'claude-opus-5',
        settingsPath: path.join(os.tmpdir(), 'clide-no-such-settings.json'),
      });
      assert.equal(auto.source, 'auto');
      assert.equal(auto.cap, undefined);
      assert.equal(auto.modelWindow, 1_000_000);

      // The env cap outranks settings, and the model window is reported beside it
      // so a capped 1M model can never be shown as a 200K one.
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000';
      try {
        const capped = resolveClaudeCeilingProvenance({ model: 'claude-opus-5' });
        assert.equal(capped.source, 'env');
        assert.equal(capped.cap, 200_000);
        assert.equal(capped.modelWindow, 1_000_000);
      } finally {
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      }
    });
  });

  test('the derived ceiling carries the threshold and the enabled flag', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-derived-ceiling-test-'));
    const settingsPath = path.join(dir, 'settings.json');
    const derived = (model: string) => {
      let result = resolveClaudeDerivedCeiling();
      withoutEnv(['CONTEXT_WINDOW', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_1M_CONTEXT'], () => {
        resetClaudeContextWindowCache();
        result = resolveClaudeDerivedCeiling({ model, settingsPath });
      });
      return result;
    };

    try {
      // A cap moves the threshold with it: the window is where compaction is
      // measured from, never where it fires.
      await writeFile(settingsPath, JSON.stringify({ autoCompactWindow: 200000 }), 'utf8');
      assert.deepEqual(derived('claude-opus-5'), {
        contextWindow: 200_000,
        autoCompactThreshold: 167_000,
        isAutoCompactEnabled: true,
      });

      await writeFile(settingsPath, JSON.stringify({ autoCompactEnabled: false }), 'utf8');
      assert.deepEqual(derived('claude-opus-5'), {
        contextWindow: 967_000,
        autoCompactThreshold: 934_000,
        isAutoCompactEnabled: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('claude-autocompact-settings', () => {
  const withSettingsFile = async (
    initial: string | null,
    run: (settingsPath: string) => Promise<void>,
  ): Promise<void> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clide-autocompact-'));
    const settingsPath = path.join(directory, 'settings.json');
    try {
      if (initial !== null) {
        await fs.writeFile(settingsPath, initial, 'utf8');
      }
      await run(settingsPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  test('a missing autoCompactWindow reads as auto, and a missing enabled flag as on', async () => {
    await withSettingsFile('{"theme":"dark"}', async (settingsPath) => {
      const settings = await readClaudeAutoCompactSettings(settingsPath);
      assert.equal(settings.window, null);
      assert.equal(settings.enabled, true);
      // A 1M model exists, so the picker must be able to offer a 1M cap.
      assert.equal(settings.maxWindow, 1_000_000);
      assert.equal(settings.options[0], 100_000);
      assert.equal(settings.options.at(-1), 1_000_000);
    });
  });

  test('choosing auto deletes the key rather than writing a sentinel', async () => {
    await withSettingsFile('{"autoCompactWindow":200000,"theme":"dark"}', async (settingsPath) => {
      assert.equal((await readClaudeAutoCompactSettings(settingsPath)).window, 200_000);

      const after = await writeClaudeAutoCompactSettings({ window: null }, settingsPath);
      assert.equal(after.window, null);

      // `/autocompact` writes auto as absence; a sentinel would read back as a cap.
      const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
      assert.equal('autoCompactWindow' in raw, false);
      // Everything CLIde does not own survives the write.
      assert.equal(raw.theme, 'dark');
    });
  });

  test('a write preserves unrelated keys and toggles the enabled flag', async () => {
    await withSettingsFile('{"theme":"dark","hooks":{"Stop":[]}}', async (settingsPath) => {
      await writeClaudeAutoCompactSettings({ enabled: false, window: 300_000 }, settingsPath);

      const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
      assert.equal(raw.autoCompactEnabled, false);
      assert.equal(raw.autoCompactWindow, 300_000);
      assert.equal(raw.theme, 'dark');
      assert.deepEqual(raw.hooks, { Stop: [] });
    });
  });

  test('no settings file at all is writable, not an error', async () => {
    await withSettingsFile(null, async (settingsPath) => {
      const after = await writeClaudeAutoCompactSettings({ window: 500_000 }, settingsPath);
      assert.equal(after.window, 500_000);
      assert.equal(after.enabled, true);
    });
  });

  test('the env override is reported so the UI can stop claiming the file wins', async () => {
    await withSettingsFile('{"autoCompactWindow":200000}', async (settingsPath) => {
      const saved = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '400000';
      try {
        const settings = await readClaudeAutoCompactSettings(settingsPath);
        assert.equal(settings.envOverride, 400_000);
        assert.equal(settings.window, 200_000);
      } finally {
        if (saved === undefined) delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
        else process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = saved;
      }
    });
  });
});
