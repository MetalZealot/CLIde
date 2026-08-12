import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const GENERATION_TIMEOUT_MS = 30_000;
const GENERATION_MAX_BUFFER_BYTES = 1024 * 1024;

const REQUIRED_PROTOCOL_PATTERNS = new Map<string, RegExp[]>([
  ['ClientRequest.ts', [
    /"method": "initialize"/,
    /"method": "thread\/start"/,
    /"method": "thread\/resume"/,
    /"method": "thread\/fork"/,
    /"method": "turn\/start"/,
    /"method": "turn\/interrupt"/,
  ]],
  ['ServerRequest.ts', [
    /item\/commandExecution\/requestApproval/,
    /item\/fileChange\/requestApproval/,
    /item\/permissions\/requestApproval/,
    /item\/tool\/requestUserInput/,
  ]],
  ['ServerNotification.ts', [
    /item\/completed/,
    /thread\/tokenUsage\/updated/,
    /turn\/completed/,
    /serverRequest\/resolved/,
  ]],
  ['v2/ThreadForkParams.ts', [
    /lastTurnId\?: string \| null/,
    /beforeTurnId\?: string \| null/,
  ]],
  ['v2/TurnStartParams.ts', [
    /collaborationMode\?: CollaborationMode/,
    /sandboxPolicy\?: SandboxPolicy/,
    /effort\?: ReasoningEffort/,
  ]],
  ['v2/TokenUsageBreakdown.ts', [/cacheWriteInputTokens: number/]],
  ['v2/ToolRequestUserInputParams.ts', [
    /isBlocking: boolean/,
    /autoResolutionMs: number \| null/,
  ]],
  ['v2/ToolRequestUserInputQuestion.ts', [
    /id: string/,
    /isOther: boolean/,
    /isSecret: boolean/,
    /options:/,
  ]],
  ['v2/ToolRequestUserInputResponse.ts', [
    /answers: \{ \[key in string\]\?: ToolRequestUserInputAnswer \}/,
  ]],
]);

const runProtocolGeneration = async (executablePath: string, outputPath: string): Promise<void> => {
  const isJavaScriptLauncher = ['.js', '.cjs', '.mjs'].includes(path.extname(executablePath).toLowerCase());
  const command = isJavaScriptLauncher ? process.execPath : executablePath;
  const args = [
    ...(isJavaScriptLauncher ? [executablePath] : []),
    'app-server',
    'generate-ts',
    '--experimental',
    '--out',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, {
      env: process.env,
      maxBuffer: GENERATION_MAX_BUFFER_BYTES,
      timeout: GENERATION_TIMEOUT_MS,
      windowsHide: true,
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const generatedProtocolIsCompatible = async (outputPath: string): Promise<boolean> => {
  for (const [relativePath, patterns] of REQUIRED_PROTOCOL_PATTERNS) {
    const content = await readFile(path.join(outputPath, relativePath), 'utf8');
    if (patterns.some((pattern) => !pattern.test(content))) {
      return false;
    }
  }
  return true;
};

/**
 * The generated-contract test uses this gate; runtime selection reuses the same
 * structural result without launching a Chat session.
 */
export const checkCodexAppServerCompatibility = async (
  executablePath: string,
): Promise<'compatible' | 'incompatible' | 'check_failed'> => {
  let tempRoot: string;
  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-protocol-'));
  } catch {
    return 'check_failed';
  }

  try {
    try {
      await runProtocolGeneration(executablePath, tempRoot);
    } catch {
      return 'check_failed';
    }

    try {
      return await generatedProtocolIsCompatible(tempRoot)
        ? 'compatible'
        : 'incompatible';
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'incompatible'
        : 'check_failed';
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
};
