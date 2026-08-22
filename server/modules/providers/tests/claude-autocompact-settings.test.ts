import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readClaudeAutoCompactSettings,
  writeClaudeAutoCompactSettings,
} from '@/modules/providers/list/claude/claude-autocompact.settings.js';

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
