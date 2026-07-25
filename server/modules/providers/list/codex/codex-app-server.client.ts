import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline';

type RequestId = number;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export type CodexAppServerCommand = {
  command: string;
  args: string[];
};

type ReadCodexAccountUsageOptions = {
  command?: CodexAppServerCommand;
  timeoutMs?: number;
};

export type CodexAccountUsageResponse = {
  rateLimits: unknown;
  activity?: unknown;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_STDERR_LENGTH = 4_000;

const moduleRequire = createRequire(import.meta.url);

/**
 * Resolves the CLI shipped with @openai/codex-sdk rather than whichever
 * unrelated global `codex` happens to be on PATH.
 */
export const resolveBundledCodexAppServerCommand = (): CodexAppServerCommand => ({
  command: process.execPath,
  args: [moduleRequire.resolve('@openai/codex/bin/codex.js'), 'app-server', '--stdio'],
});

export class CodexAppServerRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'CodexAppServerRpcError';
    this.code = code;
  }
}

const readRpcError = (value: unknown): CodexAppServerRpcError | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'number' || typeof record.message !== 'string') {
    return null;
  }

  return new CodexAppServerRpcError(record.code, record.message);
};

/**
 * Starts a short-lived Codex app-server, completes the initialize handshake,
 * and reads the stable account usage surfaces.
 *
 * The app-server protocol is newline-delimited JSON. Notifications may arrive
 * between responses, so requests are correlated by id rather than by line
 * position. The child is always terminated after this single read; the shared
 * provider-usage service supplies the longer-lived cache.
 */
export const readCodexAccountUsage = async (
  {
    command = resolveBundledCodexAppServerCommand(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: ReadCodexAccountUsageOptions = {},
): Promise<CodexAccountUsageResponse> => {
  const child = spawn(command.command, command.args, {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lineReader = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const pending = new Map<RequestId, PendingRequest>();
  let nextRequestId = 0;
  let stderr = '';
  let finished = false;

  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };

  child.stderr.on('data', (chunk: Buffer | string) => {
    if (stderr.length < MAX_STDERR_LENGTH) {
      stderr += String(chunk).slice(0, MAX_STDERR_LENGTH - stderr.length);
    }
  });

  child.once('error', (error) => {
    rejectPending(error);
  });

  child.stdin.on('error', (error) => {
    rejectPending(error);
  });

  child.once('close', (code, signal) => {
    if (finished || pending.size === 0) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    const stderrDetail = stderr.trim();
    rejectPending(new Error(
      `Codex app-server exited with ${detail}${stderrDetail ? `: ${stderrDetail}` : ''}`,
    ));
  });

  lineReader.on('line', (line) => {
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('response is not an object');
      }
      message = parsed as Record<string, unknown>;
    } catch (error) {
      rejectPending(new Error(
        `Codex app-server returned invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`,
      ));
      return;
    }

    const id = message.id;
    if (typeof id !== 'number') {
      return;
    }

    const request = pending.get(id);
    if (!request) {
      return;
    }
    pending.delete(id);

    const rpcError = readRpcError(message.error);
    if (rpcError) {
      request.reject(rpcError);
      return;
    }

    if (!('result' in message)) {
      request.reject(new Error(`Codex app-server response ${id} has no result.`));
      return;
    }

    request.resolve(message.result);
  });

  const writeMessage = (message: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        writeMessage({ id, method, params });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error('Failed to write to Codex app-server.'));
      }
    });
  };

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const stderrDetail = stderr.trim();
      reject(new Error(
        `Codex app-server timed out after ${timeoutMs}ms${stderrDetail ? `: ${stderrDetail}` : ''}.`,
      ));
    }, timeoutMs);
    timeout.unref();
  });

  const operation = (async (): Promise<CodexAccountUsageResponse> => {
    await request('initialize', {
      clientInfo: {
        name: 'clide',
        title: 'CLIde',
        version: '1',
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    writeMessage({ method: 'initialized' });

    const [rateLimitsResult, activityResult] = await Promise.allSettled([
      request('account/rateLimits/read', null),
      request('account/usage/read', null),
    ]);

    if (rateLimitsResult.status === 'rejected') {
      throw rateLimitsResult.reason;
    }

    return {
      rateLimits: rateLimitsResult.value,
      ...(activityResult.status === 'fulfilled'
        ? { activity: activityResult.value }
        : {}),
    };
  })();

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    finished = true;
    lineReader.close();
    rejectPending(new Error('Codex app-server request closed.'));
    try {
      child.stdin.end();
    } catch {
      // The process may already have closed its pipes after writing the response.
    }
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
      // Best-effort cleanup; the process may already have exited.
    }
  }
};
