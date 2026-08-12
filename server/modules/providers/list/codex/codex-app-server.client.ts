import {
  JsonlRpcClient,
  JsonlRpcError,
  type JsonlRpcCommand,
} from '@/modules/providers/shared/jsonl-rpc.client.js';
import { resolveSelectedCodexRuntimeCommand } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';

export type CodexAppServerCommand = JsonlRpcCommand;

type ReadCodexAccountUsageOptions = {
  command?: CodexAppServerCommand;
  timeoutMs?: number;
};

type ReadCodexModelListOptions = ReadCodexAccountUsageOptions;

export type CodexLiveModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string;
  isDefault: boolean;
};

type CodexModelListResponse = {
  data: CodexLiveModel[];
  nextCursor: string | null;
};

export type CodexAccountUsageResponse = {
  rateLimits: unknown;
  activity?: unknown;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Backwards-compatible name retained for the usage provider and its tests.
 * The implementation now lives in the reusable JSONL RPC transport.
 */
export class CodexAppServerRpcError extends JsonlRpcError {
  constructor(code: number, message: string, data?: unknown) {
    super(code, message, data);
    this.name = 'CodexAppServerRpcError';
  }
}

/**
 * Starts a short-lived Codex App Server, completes the initialize handshake,
 * and reads the stable account usage surfaces. Chat uses the same JSONL RPC
 * client but owns a separate lazy, supervised long-lived process.
 */
export const readCodexAccountUsage = async (
  {
    command,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: ReadCodexAccountUsageOptions = {},
): Promise<CodexAccountUsageResponse> => {
  const resolvedCommand = command
    ?? (await resolveSelectedCodexRuntimeCommand(
      'usage',
      ['app-server', '--stdio'],
    )).command;
  const client = new JsonlRpcClient({
    command: resolvedCommand,
    requestTimeoutMs: timeoutMs,
  });
  client.open();

  try {
    await client.request('initialize', {
      clientInfo: {
        name: 'clide',
        title: 'CLIde',
        version: '1',
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    client.notify('initialized', {});

    const [rateLimitsResult, activityResult] = await Promise.allSettled([
      client.request('account/rateLimits/read', null),
      client.request('account/usage/read', null),
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
  } finally {
    client.close('Codex account usage read completed.');
  }
};

/** Reads the model catalog from the same selected executable as every other Codex facet. */
export const readCodexModelList = async (
  {
    command,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: ReadCodexModelListOptions = {},
): Promise<CodexLiveModel[]> => {
  const resolvedCommand = command
    ?? (await resolveSelectedCodexRuntimeCommand(
      'models',
      ['app-server', '--stdio'],
    )).command;
  const client = new JsonlRpcClient({
    command: resolvedCommand,
    requestTimeoutMs: timeoutMs,
  });
  client.open();

  try {
    await client.request('initialize', {
      clientInfo: {
        name: 'clide',
        title: 'CLIde',
        version: '1',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    client.notify('initialized', {});

    const models: CodexLiveModel[] = [];
    let cursor: string | null = null;
    do {
      const response: CodexModelListResponse = await client.request('model/list', {
        cursor,
        limit: 100,
      });
      models.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);
    return models;
  } finally {
    client.close('Codex model list read completed.');
  }
};
