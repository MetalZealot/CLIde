import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureClaudeContextUsage,
  clearClaudeContextCeilings,
  getClaudeContextCeiling,
  loadClaudeContextCeiling,
  parseClaudeContextUsage,
  rememberClaudeContextCeiling,
} from '@/modules/providers/list/claude/claude-context-usage.js';

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
