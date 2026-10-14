import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';

import { startShellCommand } from '@/modules/chat-shell/index.js';
import { formatBashModeBlock, parseBashModeBlock } from '@/shared/utils.js';

const scratch = await mkdtemp(path.join(tmpdir(), 'clide-shell-test-'));
after(() => rm(scratch, { recursive: true, force: true }));

function run(command: string, extra: { signal?: AbortSignal; timeoutMs?: number; inlineLimit?: number } = {}) {
  return startShellCommand({
    command,
    cwd: scratch,
    signal: extra.signal ?? new AbortController().signal,
    outputName: `out-${Date.now()}`,
    outputDir: path.join(scratch, 'spill'),
    timeoutMs: extra.timeoutMs,
    inlineLimit: extra.inlineLimit,
  });
}

describe('chat shell runner', () => {
  test('runs in the given folder and keeps stdout and stderr apart', async () => {
    const result = await run('pwd; echo oops >&2').result;
    assert.equal(result.state, 'done');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), scratch);
    assert.equal(result.stderr.trim(), 'oops');
    assert.match(result.output, /oops/);
  });

  test('a non-zero exit is a failure; colour codes and progress rewrites are cleaned', async () => {
    const result = await run(String.raw`printf '\033[31mred\033[0m\n50%%\r100%%\n'; exit 3`).result;
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout, 'red\n100%\n');
  });

  test('stdin is closed, so a command waiting on input ends at once', async () => {
    const result = await run('read line; echo "got:$line"', { timeoutMs: 5_000 }).result;
    assert.equal(result.state, 'done');
    assert.equal(result.stdout.trim(), 'got:');
  });

  test('output past the inline limit spills whole to a file', async () => {
    const result = await run('seq 1 2000', { inlineLimit: 100 }).result;
    assert.equal(result.truncated, true);
    assert.equal(result.output.length, 100);
    assert.ok(result.fullOutputPath && existsSync(result.fullOutputPath));
    const full = readFileSync(result.fullOutputPath!, 'utf8');
    assert.equal(full.trim().split('\n').length, 2000);
  });

  test('a stop kills the whole process group', async () => {
    const controller = new AbortController();
    const pidFile = path.join(scratch, 'child.pid');
    const handle = run(`sleep 30 & echo $! > ${pidFile}; wait`, { signal: controller.signal });
    for (let i = 0; i < 50 && !existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await handle.result;
    assert.equal(result.state, 'stopped');
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(childPid, 0), 'the backgrounded child died with its group');
  });

  test('the time limit stops it as timed out', async () => {
    const result = await run('sleep 30', { timeoutMs: 200 }).result;
    assert.equal(result.state, 'timed_out');
  });
});

describe('bash mode block', () => {
  test('round-trips, with a non-zero exit carried as the Bash tool words it', () => {
    const text = formatBashModeBlock({ command: 'npm test', stdout: 'ok\n', stderr: 'boom\n', exitCode: 1 });
    assert.equal(text, '<bash-input>npm test</bash-input>\n<bash-stdout>ok</bash-stdout><bash-stderr>boom\nExit code 1</bash-stderr>');
    const parsed = parseBashModeBlock(text);
    assert.deepEqual(parsed, { command: 'npm test', stdout: 'ok', stderr: 'boom', exitCode: 1, rest: '' });
  });

  test('reads Claude Code\'s two rows on their own, and ignores ordinary text', () => {
    assert.deepEqual(parseBashModeBlock('<bash-input>ls</bash-input>'), { command: 'ls', exitCode: null, rest: '' });
    assert.deepEqual(
      parseBashModeBlock('<bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>'),
      { stdout: 'a\nb', stderr: '', exitCode: 0, rest: '' },
    );
    assert.equal(parseBashModeBlock('run <bash-input>ls</bash-input>'), null);
  });
});
