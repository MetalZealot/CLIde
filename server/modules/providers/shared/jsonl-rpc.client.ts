import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

export type JsonlRpcId = string | number;

export type JsonlRpcCommand = {
  command: string;
  args: string[];
};

export type JsonlRpcMessage = Record<string, unknown>;

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
};

export type JsonlRpcClientOptions = {
  command: JsonlRpcCommand;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxStderrLength?: number;
  onNotification?: (method: string, params: unknown) => void | Promise<void>;
  onServerRequest?: (request: {
    id: JsonlRpcId;
    method: string;
    params: unknown;
  }) => void | Promise<void>;
  onExit?: (error: Error) => void;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDERR_LENGTH = 4_000;

export class JsonlRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'JsonlRpcError';
    this.code = code;
    this.data = data;
  }
}

function readRpcError(value: unknown): JsonlRpcError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'number' || typeof record.message !== 'string') {
    return null;
  }

  return new JsonlRpcError(record.code, record.message, record.data);
}

function isRpcId(value: unknown): value is JsonlRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

/**
 * Small JSONL JSON-RPC-like client shared by Codex's short-lived account
 * reader and long-lived Chat transport.
 *
 * App Server deliberately omits the normal `jsonrpc: "2.0"` field. Responses,
 * notifications, and server-to-client requests can arrive in any order, so
 * the client correlates only response ids and routes the other two shapes to
 * callbacks.
 */
export class JsonlRpcClient {
  private readonly options: JsonlRpcClientOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private readonly pending = new Map<JsonlRpcId, PendingRequest>();
  private nextRequestId = 0;
  private stderr = '';
  private closed = false;
  private terminalError: Error | null = null;

  constructor(options: JsonlRpcClientOptions) {
    this.options = options;
  }

  get isOpen(): boolean {
    return Boolean(this.child && !this.closed && this.child.exitCode === null);
  }

  get stderrOutput(): string {
    return this.stderr.trim();
  }

  open(): void {
    if (this.child) {
      throw new Error('JSONL RPC client has already been opened.');
    }

    this.closed = false;
    this.terminalError = null;
    this.child = spawn(this.options.command.command, this.options.command.args, {
      env: this.options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.lineReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    this.child.stderr.on('data', (chunk: Buffer | string) => {
      const maxLength = this.options.maxStderrLength ?? DEFAULT_MAX_STDERR_LENGTH;
      if (this.stderr.length < maxLength) {
        this.stderr += String(chunk).slice(0, maxLength - this.stderr.length);
      }
    });

    this.child.stdin.on('error', (error) => {
      this.fail(error);
    });
    this.child.once('error', (error) => {
      this.fail(error);
    });
    this.child.once('close', (code, signal) => {
      if (this.closed) {
        return;
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      const stderrDetail = this.stderrOutput;
      this.fail(new Error(
        `JSONL RPC process exited with ${detail}${stderrDetail ? `: ${stderrDetail}` : ''}`,
      ));
    });

    this.lineReader.on('line', (line) => {
      this.handleLine(line);
    });
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.nextRequestId++;

    return new Promise<T>((resolve, reject) => {
      if (!this.isOpen) {
        reject(this.terminalError ?? new Error('JSONL RPC process is not running.'));
        return;
      }

      const pending: PendingRequest = {
        method,
        resolve: (result) => resolve(result as T),
        reject,
      };
      if (timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`JSONL RPC request "${method}" timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        pending.timeout.unref?.();
      }

      this.pending.set(id, pending);
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        reject(error instanceof Error ? error : new Error('Failed to write JSONL RPC request.'));
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ method, params });
  }

  respond(id: JsonlRpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: JsonlRpcId, code: number, message: string, data?: unknown): void {
    this.write({
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    });
  }

  close(reason = 'JSONL RPC client closed.'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const error = new Error(reason);
    this.rejectPending(error);
    this.lineReader?.close();
    this.lineReader = null;

    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }

    try {
      child.stdin.end();
    } catch {
      // The process may already have closed its pipe.
    }
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
      // Best-effort cleanup after an already-finished process.
    }
  }

  private write(message: JsonlRpcMessage): void {
    if (!this.isOpen || !this.child) {
      throw this.terminalError ?? new Error('JSONL RPC process is not running.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonlRpcMessage;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('frame is not an object');
      }
      message = parsed as JsonlRpcMessage;
    } catch (error) {
      this.fail(new Error(
        `JSONL RPC process returned an invalid frame: ${
          error instanceof Error ? error.message : 'unknown parse error'
        }`,
      ));
      return;
    }

    const id = message.id;
    const method = message.method;

    if (isRpcId(id) && typeof method !== 'string') {
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }

      const rpcError = readRpcError(message.error);
      if (rpcError) {
        pending.reject(rpcError);
      } else if ('result' in message) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(
          `JSONL RPC response ${String(id)} for "${pending.method}" has neither result nor error.`,
        ));
      }
      return;
    }

    if (typeof method !== 'string') {
      this.fail(new Error('JSONL RPC frame has neither a response id nor a method.'));
      return;
    }

    if (isRpcId(id)) {
      void Promise.resolve(this.options.onServerRequest?.({
        id,
        method,
        params: message.params,
      })).catch((error) => {
        const requestError = error instanceof Error ? error : new Error(String(error));
        this.respondError(id, -32603, requestError.message);
      });
      return;
    }

    void Promise.resolve(this.options.onNotification?.(method, message.params)).catch((error) => {
      const notificationError = error instanceof Error ? error : new Error(String(error));
      console.error(`[JsonlRpcClient] Notification handler failed for "${method}":`, notificationError);
    });
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.terminalError = error;
    this.closed = true;
    this.rejectPending(error);
    this.lineReader?.close();
    this.lineReader = null;
    const child = this.child;
    this.child = null;
    try {
      if (child && !child.killed) {
        child.kill();
      }
    } catch {
      // The process may already be gone.
    }
    this.options.onExit?.(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(error);
    }
    this.pending.clear();
  }
}
