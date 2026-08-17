// Shared server helpers: Claude CLI path resolution and tail-page slicing.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { resolveClaudeCodeExecutablePath, type ResolveClaudeCodeExecutablePathDependencies } from '@/shared/claude-cli-path.js';
import { sliceTailPage } from '@/shared/utils.js';

describe('claude-cli-path', () => {
  test('resolveClaudeCodeExecutablePath resolves the npm Claude wrapper to its native exe on Windows', () => {
    const wrapperDir = 'C:\\nvm4w\\nodejs';
    const nativePath = `${wrapperDir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const execFileSync =
      (() => `${wrapperDir}\\claude\r\n${wrapperDir}\\claude.cmd\r\n`) as unknown as ResolveClaudeCodeExecutablePathDependencies['execFileSync'];
    const readFileSync = (() => '') as unknown as ResolveClaudeCodeExecutablePathDependencies['readFileSync'];

    const resolved = resolveClaudeCodeExecutablePath('claude', {
      platform: 'win32',
      execFileSync,
      existsSync: (candidate) => candidate === nativePath,
      readFileSync,
    });

    assert.equal(resolved, nativePath);
  });

  test('resolveClaudeCodeExecutablePath keeps an explicit JavaScript launcher path unchanged', () => {
    const scriptPath = 'C:\\tools\\claude.js';

    const resolved = resolveClaudeCodeExecutablePath(scriptPath, {
      platform: 'win32',
    });

    assert.equal(resolved, scriptPath);
  });

  test('resolveClaudeCodeExecutablePath can parse a wrapper file path containing letters r and n before claude.exe', () => {
    const wrapperPath = 'C:\\tools\\claude';
    const nativePath = 'C:\\tools\\custom\\bin\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    const readFileSync = (() => `exec "$basedir/custom/bin/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$@"`) as unknown as ResolveClaudeCodeExecutablePathDependencies['readFileSync'];

    const resolved = resolveClaudeCodeExecutablePath(wrapperPath, {
      platform: 'win32',
      existsSync: (candidate) => candidate === nativePath,
      readFileSync,
    });

    assert.equal(resolved, nativePath);
  });

  test('resolveClaudeCodeExecutablePath falls back to the configured command when PATH lookup fails', () => {
    const execFileSync = (() => {
      throw new Error('not found');
    }) as unknown as ResolveClaudeCodeExecutablePathDependencies['execFileSync'];

    const resolved = resolveClaudeCodeExecutablePath('claude', {
      platform: 'win32',
      execFileSync,
    });

    assert.equal(resolved, 'claude');
  });
});

describe('slice-tail-page', () => {
  const ITEMS = ['a', 'b', 'c', 'd', 'e'];

  test('offset 0 returns the most recent page', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, 2, 0);
    assert.deepEqual(page, ['d', 'e']);
    assert.equal(hasMore, true);
  });

  test('increasing offsets walk backwards in time', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, 2, 2);
    assert.deepEqual(page, ['b', 'c']);
    assert.equal(hasMore, true);
  });

  test('the oldest page reports hasMore false', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, 2, 4);
    assert.deepEqual(page, ['a']);
    assert.equal(hasMore, false);
  });

  test('null limit returns everything', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, null, 0);
    assert.deepEqual(page, ITEMS);
    assert.equal(hasMore, false);
  });

  test('offsets past the start return an empty page', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, 3, 10);
    assert.deepEqual(page, []);
    assert.equal(hasMore, false);
  });

  test('zero limit returns an empty page but keeps hasMore accurate', () => {
    const { page, hasMore } = sliceTailPage(ITEMS, 0, 0);
    assert.deepEqual(page, []);
    assert.equal(hasMore, true);
  });
});
