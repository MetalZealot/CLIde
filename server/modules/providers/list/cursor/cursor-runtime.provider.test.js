import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  abortCursorSession,
  cursorRuntime,
  isCursorSessionActive,
} from './cursor-runtime.provider.js';

const runtimeContext = {
  resolveProviderSessionId: (sessionId) => sessionId || null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function waitFor(predicate, { timeoutMs = 10000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Regression guard for 9a9d47b. Cursor has no AbortController tier, so the
// id-keyed process map is the only thing Stop has to work with: if the runtime
// keys on the provider-native id while the gateway aborts with the app id, the
// button silently does nothing. OpenCode is the same shape — see
// opencode-runtime.provider.test.js.
async function createHangingCursorExecutable(binDir, startedMarkerPath) {
  const scriptPath = path.join(binDir, 'cursor-agent.js');
  await writeFile(scriptPath, `
require('node:fs').writeFileSync(${JSON.stringify(startedMarkerPath)}, 'started');
// Hang until signalled. SIGTERM keeps its default disposition on purpose.
// The self-exit is a backstop: if the abort never lands the test fails on its
// own timeout, and this stops the orphan from wedging the test runner.
setTimeout(() => process.exit(0), 30000);
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'cursor-agent.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0cursor-agent.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'cursor-agent');
  // `exec` so the shell is replaced by node and SIGTERM reaches the process
  // that is actually hanging, rather than orphaning it behind a live `sh`.
  await writeFile(commandPath, '#!/bin/sh\nexec node "$(dirname "$0")/cursor-agent.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

test('abortCursorSession stops a live run keyed by the app session id', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cursor-cli-abort-'));
  const startedMarkerPath = path.join(tempRoot, 'started');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  // Deliberately unequal id spaces, the same way chat-session-addressing.test.ts
  // drives the gateway — identity mapping would hide the bug entirely.
  const appSessionId = 'app-session-abort-1';
  const providerSessionId = 'cursor-native-abort-1';
  const abortContext = {
    ...runtimeContext,
    resolveProviderSessionId: (sessionId) =>
      (sessionId === appSessionId ? providerSessionId : null),
  };
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createHangingCursorExecutable(tempRoot, startedMarkerPath);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const settled = { rejected: false };
    const run = cursorRuntime
      .run('Hi', { cwd: tempRoot, sessionId: appSessionId }, writer, abortContext)
      .then(() => {}, () => { settled.rejected = true; });

    await waitFor(
      () => access(startedMarkerPath).then(() => true, () => false),
      { label: 'the fake Cursor CLI to start' },
    );
    await waitFor(
      () => isCursorSessionActive(appSessionId),
      { label: 'the run to register under the app session id' },
    );

    // The app id is the only key Stop can reach the process by.
    assert.equal(isCursorSessionActive(providerSessionId), false);
    assert.equal(abortCursorSession(providerSessionId), false);
    assert.equal(abortCursorSession(appSessionId), true);

    await run;

    assert.equal(settled.rejected, true, 'the killed run should reject, not resolve');
    assert.equal(isCursorSessionActive(appSessionId), false);
    // The gateway's abort handler owns the terminal aborted `complete`; the
    // runtime must not emit a second one on close.
    assert.equal(messages.some((message) => message.kind === 'complete'), false);
  } finally {
    abortCursorSession(appSessionId);

    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
