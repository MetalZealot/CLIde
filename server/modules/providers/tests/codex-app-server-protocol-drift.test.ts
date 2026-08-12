import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const moduleRequire = createRequire(import.meta.url);
const EXPECTED_CODEX_VERSION = '0.147.0';

test(`Codex SDK and bundled CLI stay pinned to ${EXPECTED_CODEX_VERSION}`, () => {
  const codexBin = moduleRequire.resolve('@openai/codex/bin/codex.js');
  const sdk = JSON.parse(readFileSync(
    path.resolve(codexBin, '../../../codex-sdk/package.json'),
    'utf8',
  )) as { version: string };
  const cli = JSON.parse(readFileSync(
    path.resolve(codexBin, '../../package.json'),
    'utf8',
  )) as { version: string };
  assert.equal(sdk.version, EXPECTED_CODEX_VERSION);
  assert.equal(cli.version, EXPECTED_CODEX_VERSION);
});

test(`generated ${EXPECTED_CODEX_VERSION} protocol retains CLIde Chat methods and fields`, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-protocol-'));
  try {
    execFileSync(process.execPath, [
      moduleRequire.resolve('@openai/codex/bin/codex.js'),
      'app-server',
      'generate-ts',
      '--experimental',
      '--out',
      tempRoot,
    ], {
      stdio: 'pipe',
      env: process.env,
    });

    const [
      clientRequest,
      serverRequest,
      notifications,
      threadFork,
      turnStart,
      tokenUsage,
      questionParams,
      question,
      questionResponse,
    ] =
      await Promise.all([
        readFile(path.join(tempRoot, 'ClientRequest.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'ServerRequest.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'ServerNotification.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'ThreadForkParams.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'TurnStartParams.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'TokenUsageBreakdown.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'ToolRequestUserInputParams.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'ToolRequestUserInputQuestion.ts'), 'utf8'),
        readFile(path.join(tempRoot, 'v2', 'ToolRequestUserInputResponse.ts'), 'utf8'),
      ]);

    for (const method of ['initialize', 'thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'turn/interrupt']) {
      assert.match(clientRequest, new RegExp(`"method": "${method.replace('/', '\\/')}"`));
    }
    for (const method of [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'item/tool/requestUserInput',
    ]) {
      assert.match(serverRequest, new RegExp(method.replace('/', '\\/')));
    }
    for (const method of [
      'item/completed',
      'thread/tokenUsage/updated',
      'turn/completed',
      'serverRequest/resolved',
    ]) {
      assert.match(notifications, new RegExp(method.replace('/', '\\/')));
    }

    assert.match(threadFork, /lastTurnId\?: string \| null/);
    assert.match(threadFork, /beforeTurnId\?: string \| null/);
    assert.match(turnStart, /collaborationMode\?: CollaborationMode/);
    assert.match(turnStart, /sandboxPolicy\?: SandboxPolicy/);
    assert.match(turnStart, /effort\?: ReasoningEffort/);
    assert.match(tokenUsage, /cacheWriteInputTokens: number/);
    assert.match(questionParams, /isBlocking: boolean/);
    assert.match(questionParams, /autoResolutionMs: number \| null/);
    for (const field of ['id: string', 'isOther: boolean', 'isSecret: boolean', 'options:']) {
      assert.match(question, new RegExp(field));
    }
    assert.match(questionResponse, /answers: \{ \[key in string\]\?: ToolRequestUserInputAnswer \}/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
