import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const GENERATION_TIMEOUT_MS = 30_000;
const GENERATION_MAX_BUFFER_BYTES = 1024 * 1024;

type RequiredProtocolPattern = {
  detail: string;
  pattern: RegExp;
};

export type CodexAppServerCompatibilityDetail = {
  compatibility: 'compatible' | 'incompatible' | 'check_failed';
  detail: string | null;
};

const required = (detail: string, pattern: RegExp): RequiredProtocolPattern => ({ detail, pattern });

const REQUIRED_PROTOCOL_PATTERNS = new Map<string, RequiredProtocolPattern[]>([
  ['ClientRequest.ts', [
    required('method initialize', /"method": "initialize"/),
    required('method thread/start', /"method": "thread\/start"/),
    required('method thread/resume', /"method": "thread\/resume"/),
    required('method thread/fork', /"method": "thread\/fork"/),
    required('method turn/start', /"method": "turn\/start"/),
    required('method turn/interrupt', /"method": "turn\/interrupt"/),
    required('method model/list', /"method": "model\/list"/),
  ]],
  ['ServerRequest.ts', [
    required('method item/commandExecution/requestApproval', /item\/commandExecution\/requestApproval/),
    required('method item/fileChange/requestApproval', /item\/fileChange\/requestApproval/),
    required('method item/permissions/requestApproval', /item\/permissions\/requestApproval/),
    required('method item/tool/requestUserInput', /item\/tool\/requestUserInput/),
  ]],
  ['ServerNotification.ts', [
    required('method item/completed', /item\/completed/),
    required('method thread/tokenUsage/updated', /thread\/tokenUsage\/updated/),
    required('method turn/completed', /turn\/completed/),
    required('method serverRequest/resolved', /serverRequest\/resolved/),
  ]],
  ['v2/ThreadForkParams.ts', [
    required('field lastTurnId', /lastTurnId\?: string \| null/),
    required('field beforeTurnId', /beforeTurnId\?: string \| null/),
  ]],
  ['v2/TurnStartParams.ts', [
    required('field collaborationMode', /collaborationMode\?: CollaborationMode/),
    required('field sandboxPolicy', /sandboxPolicy\?: SandboxPolicy/),
    required('field effort', /effort\?: ReasoningEffort/),
  ]],
  ['v2/TokenUsageBreakdown.ts', [
    required('field cacheWriteInputTokens', /cacheWriteInputTokens: number/),
  ]],
  ['v2/ToolRequestUserInputParams.ts', [
    required('field isBlocking', /isBlocking: boolean/),
    required('field autoResolutionMs', /autoResolutionMs: number \| null/),
  ]],
  ['v2/ToolRequestUserInputQuestion.ts', [
    required('field id', /id: string/),
    required('field isOther', /isOther: boolean/),
    required('field isSecret', /isSecret: boolean/),
    required('field options', /options:/),
  ]],
  ['v2/ToolRequestUserInputResponse.ts', [
    required('field answers', /answers: \{ \[key in string\]\?: ToolRequestUserInputAnswer \}/),
  ]],
  ['v2/Model.ts', [
    required('field model', /model: string/),
    required('field displayName', /displayName: string/),
    required('field supportedReasoningEfforts', /supportedReasoningEfforts:/),
    required('field defaultReasoningEffort', /defaultReasoningEffort: ReasoningEffort/),
    required('field isDefault', /isDefault: boolean/),
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

const readGeneratedProtocolCompatibility = async (
  outputPath: string,
): Promise<CodexAppServerCompatibilityDetail> => {
  for (const [relativePath, patterns] of REQUIRED_PROTOCOL_PATTERNS) {
    let content: string;
    try {
      content = await readFile(path.join(outputPath, relativePath), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { compatibility: 'incompatible', detail: `${relativePath}: ${patterns[0].detail}` };
      }
      throw error;
    }
    const missing = patterns.find(({ pattern }) => !pattern.test(content));
    if (missing) {
      return { compatibility: 'incompatible', detail: `${relativePath}: ${missing.detail}` };
    }
  }
  return { compatibility: 'compatible', detail: null };
};

/**
 * The generated-contract test uses this gate; runtime selection reuses the same
 * structural result without launching a Chat session.
 */
export function checkCodexAppServerCompatibility(
  executablePath: string,
): Promise<'compatible' | 'incompatible' | 'check_failed'>;
export function checkCodexAppServerCompatibility(
  executablePath: string,
  options: { detailed: true },
): Promise<CodexAppServerCompatibilityDetail>;
export async function checkCodexAppServerCompatibility(
  executablePath: string,
  options?: { detailed: true },
): Promise<'compatible' | 'incompatible' | 'check_failed' | CodexAppServerCompatibilityDetail> {
  const result = (compatibility: CodexAppServerCompatibilityDetail['compatibility'], detail: string | null) => (
    options?.detailed ? { compatibility, detail } : compatibility
  );
  let tempRoot: string;
  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-protocol-'));
  } catch {
    return result('check_failed', 'Could not create the protocol check workspace.');
  }

  try {
    try {
      await runProtocolGeneration(executablePath, tempRoot);
    } catch {
      return result('check_failed', 'Protocol generation failed.');
    }

    try {
      const compatibility = await readGeneratedProtocolCompatibility(tempRoot);
      return options?.detailed ? compatibility : compatibility.compatibility;
    } catch {
      return result('check_failed', 'Generated protocol files could not be read.');
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
