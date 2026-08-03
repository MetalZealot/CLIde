import {
  resolveBundledCodexAppServerCommand,
  type CodexAppServerCommand,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import {
  isCodexAppServerChatEnabled,
  markCodexAppServerReady,
  markCodexAppServerStarting,
  markCodexAppServerStopped,
  markCodexAppServerStartupFallback,
} from '@/modules/providers/list/codex/codex-chat-transport-state.js';
import type {
  CodexAdditionalFileSystemPermissions,
  CodexApprovalDecision,
  CodexApprovalPolicy,
  CodexCommandApprovalParams,
  CodexFileChangeApprovalParams,
  CodexNotification,
  CodexPermissionsApprovalParams,
  CodexQuestion,
  CodexReasoningEffort,
  CodexRequestId,
  CodexRequestPermissionProfile,
  CodexSandboxPolicy,
  CodexThreadItem,
  CodexThread,
  CodexThreadForkResponse,
  CodexThreadResponse,
  CodexTokenUsage,
  CodexToolRequestUserInputParams,
  CodexToolRequestUserInputResponse,
  CodexTurn,
  CodexTurnStartResponse,
  CodexUserInput,
} from '@/modules/providers/list/codex/codex-app-server.protocol.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { interactiveRequestRegistry } from '@/modules/providers/services/interactive-request-registry.service.js';
import {
  notifyRunFailed,
  notifyRunStopped,
} from '@/modules/notifications/index.js';
import {
  JsonlRpcClient,
  type JsonlRpcId,
} from '@/modules/providers/shared/jsonl-rpc.client.js';
import {
  buildCodexInputItems,
  normalizeImageDescriptors,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  InteractiveRequestDecision,
  InteractiveRequestResponse,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  readObjectRecord,
} from '@/shared/utils.js';

type AppServerWriter = {
  send: (message: unknown) => void;
  setSessionId?: (
    sessionId: string,
    metadata?: {
      jsonlPath?: string | null;
      projectPath?: string;
    },
  ) => void;
  userId?: string | number | null;
};

type RunNotificationBase = {
  userId: string | number | null;
  provider: string;
  sessionId: string | null;
  sessionName: string | null;
};

type RunFailedNotifier = (options: RunNotificationBase & {
  error: unknown;
}) => void;

type RunStoppedNotifier = (options: RunNotificationBase & {
  stopReason: string;
}) => void;

type AppServerChatOptions = {
  command?: CodexAppServerCommand;
  requestTimeoutMs?: number;
  trackRuntimeState?: boolean;
  notifyRunFailed?: RunFailedNotifier;
  notifyRunStopped?: RunStoppedNotifier;
};

type QueryCodexAppServerOptions = AnyRecord & {
  sessionId?: string;
  /**
   * Provider-native thread id for resume, resolved by the runtime from the
   * session row. `sessionId` is the app-facing id and is never a Codex thread
   * id, so it must not reach `thread/resume` or `thread/fork`.
   */
  providerSessionId?: string | null;
  sessionSummary?: string;
  cwd?: string;
  projectPath?: string;
  model?: string;
  effort?: string;
  images?: unknown;
  permissionMode?: string;
  rewindToMessageId?: string;
};

type ForkCodexThreadOptions = {
  cwd?: string;
  model?: string;
  permissionMode?: string;
  lastTurnId?: string;
};

type ActiveTurn = {
  threadId: string;
  /**
   * Stable app session id for this run. Inbound App Server events address the
   * thread, but the chat gateway addresses runs by the app id — so the turn
   * carries both and is reachable either way.
   */
  appSessionId: string | null;
  turnId: string | null;
  writer: AppServerWriter;
  done: Promise<void>;
  resolveDone: () => void;
  terminal: boolean;
  aborted: boolean;
  fileChanges: Map<string, unknown>;
  userId: string | number | null;
  sessionName: string | null;
};

const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PROVIDER = 'codex';
const defaultNotifyRunFailed = notifyRunFailed as RunFailedNotifier;
const defaultNotifyRunStopped = notifyRunStopped as RunStoppedNotifier;

export class CodexAppServerStartupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexAppServerStartupError';
  }
}

/**
 * Executes the fallback only for failures raised by App Server initialization.
 * Thread/turn failures deliberately escape so an accepted user instruction is
 * never retried on the SDK transport.
 */
export async function withCodexAppServerStartupFallback<T>(
  appServerQuery: () => Promise<T>,
  sdkFallback: (error: CodexAppServerStartupError) => Promise<T>,
): Promise<T> {
  try {
    return await appServerQuery();
  } catch (error) {
    if (!(error instanceof CodexAppServerStartupError)) {
      throw error;
    }
    return sdkFallback(error);
  }
}

export { isCodexAppServerChatEnabled };

function toExternalRequestId(id: CodexRequestId): string {
  return `codex:${typeof id === 'number' ? 'n' : 's'}:${String(id)}`;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEffort(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === 'string' && value !== 'default' && value.trim()
    ? value
    : undefined;
}

function readDecision(response: InteractiveRequestResponse): InteractiveRequestDecision {
  if (response.decision) {
    return response.decision;
  }
  if (response.allow) {
    return response.rememberEntry ? 'allow_session' : 'allow_once';
  }
  return 'deny';
}

function mapApprovalDecision(decision: InteractiveRequestDecision): CodexApprovalDecision {
  switch (decision) {
    case 'allow_once':
      return 'accept';
    case 'allow_session':
      return 'acceptForSession';
    case 'cancel':
      return 'cancel';
    case 'deny':
      return 'decline';
    default:
      throw new Error(`Unsupported approval decision "${String(decision)}".`);
  }
}

export function mapCodexAppServerPermissionMode(permissionMode: string | undefined): {
  approvalPolicy: CodexApprovalPolicy;
  sandboxMode: 'workspace-write' | 'danger-full-access';
  sandboxPolicy: CodexSandboxPolicy;
} {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      };
    case 'bypassPermissions':
      return {
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        sandboxPolicy: { type: 'dangerFullAccess' },
      };
    case 'plan':
    case 'default':
    default:
      return {
        approvalPolicy: 'untrusted',
        sandboxMode: 'workspace-write',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      };
  }
}

function toCodexInput(
  command: string,
  images: unknown,
  workingDirectory: string,
): CodexUserInput[] {
  if (normalizeImageDescriptors(images).length === 0) {
    return [{ type: 'text', text: command, text_elements: [] }];
  }

  return buildCodexInputItems(command, images, workingDirectory).map((item) =>
    item.type === 'text'
      ? { type: 'text', text: item.text, text_elements: [] }
      : { type: 'localImage', path: item.path },
  );
}

function tokenBudgetFromUsage(tokenUsage: CodexTokenUsage): AnyRecord {
  const last = tokenUsage.last;
  return {
    used: last.totalTokens || last.inputTokens + last.outputTokens,
    total: tokenUsage.modelContextWindow || 200_000,
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    breakdown: {
      input: last.inputTokens,
      output: last.outputTokens,
    },
  };
}

function completedItemMessages(item: CodexThreadItem, threadId: string): NormalizedMessage[] {
  const common = {
    id: item.id,
    sessionId: threadId,
    provider: PROVIDER,
  } as const;

  switch (item.type) {
    case 'userMessage':
      return [];
    case 'agentMessage':
      return item.text.trim()
        ? [createNormalizedMessage({
            ...common,
            kind: 'text',
            role: 'assistant',
            content: item.text,
          })]
        : [];
    case 'plan':
      return item.text.trim()
        ? [createNormalizedMessage({
            ...common,
            kind: 'text',
            role: 'assistant',
            content: item.text,
          })]
        : [];
    case 'reasoning': {
      const content = [...item.summary, ...item.content].filter(Boolean).join('\n');
      return content.trim()
        ? [createNormalizedMessage({
            ...common,
            kind: 'thinking',
            content,
          })]
        : [];
    }
    case 'commandExecution':
      return [createNormalizedMessage({
        ...common,
        kind: 'tool_use',
        toolName: 'Bash',
        toolInput: {
          command: item.command,
          cwd: item.cwd,
        },
        toolId: item.id,
        status: item.status,
        toolResult: item.aggregatedOutput === null && item.exitCode === null
          ? undefined
          : {
              content: item.aggregatedOutput || '',
              isError: item.exitCode !== null && item.exitCode !== 0,
            },
      })];
    case 'fileChange':
      return [createNormalizedMessage({
        ...common,
        kind: 'tool_use',
        toolName: 'FileChanges',
        toolInput: item.changes,
        toolId: item.id,
        status: item.status,
        toolResult: {
          content: item.status,
          isError: item.status === 'failed',
        },
      })];
    case 'mcpToolCall':
      return [createNormalizedMessage({
        ...common,
        kind: 'tool_use',
        toolName: item.tool || 'MCP',
        toolInput: item.arguments,
        toolId: item.id,
        server: item.server,
        status: item.status,
        toolResult: item.result === null && item.error === null
          ? undefined
          : {
              content: item.error ?? item.result ?? '',
              isError: item.error !== null,
            },
      })];
    case 'webSearch':
      return [createNormalizedMessage({
        ...common,
        kind: 'tool_use',
        toolName: 'WebSearch',
        toolInput: { query: item.query || '' },
        toolId: item.id,
      })];
    default:
      return [];
  }
}

function validateQuestions(value: unknown): CodexQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Codex user-input request must contain at least one question.');
  }

  const seenQuestionIds = new Set<string>();
  return value.map((rawQuestion) => {
    const question = readObjectRecord(rawQuestion);
    const id = readNonEmptyString(question?.id);
    const prompt = readNonEmptyString(question?.question);
    if (!question || !id || !prompt || seenQuestionIds.has(id)) {
      throw new Error('Codex user-input request contains an invalid or duplicate question id.');
    }
    seenQuestionIds.add(id);

    const options = question.options;
    if (options !== null && !Array.isArray(options)) {
      throw new Error(`Codex question "${id}" has malformed options.`);
    }
    const seenLabels = new Set<string>();
    const normalizedOptions = options === null
      ? null
      : options.map((rawOption: unknown) => {
          const option = readObjectRecord(rawOption);
          const label = readNonEmptyString(option?.label);
          if (!option || !label || seenLabels.has(label)) {
            throw new Error(`Codex question "${id}" has an invalid or duplicate option.`);
          }
          seenLabels.add(label);
          return {
            label,
            description: typeof option.description === 'string' ? option.description : '',
          };
        });

    return {
      id,
      header: typeof question.header === 'string' ? question.header : '',
      question: prompt,
      isOther: Boolean(question.isOther),
      isSecret: Boolean(question.isSecret),
      options: normalizedOptions,
    };
  });
}

function validateQuestionAnswers(
  questions: CodexQuestion[],
  response: InteractiveRequestResponse,
): CodexToolRequestUserInputResponse {
  const answers = response.answers ?? {};
  const byId = new Map(questions.map((question) => [question.id, question]));
  const output: CodexToolRequestUserInputResponse['answers'] = {};

  for (const [questionId, rawValues] of Object.entries(answers)) {
    const question = byId.get(questionId);
    if (!question) {
      throw new Error(`Answer references unknown question "${questionId}".`);
    }
    if (!Array.isArray(rawValues) || rawValues.some((value) => typeof value !== 'string')) {
      throw new Error(`Answer for question "${questionId}" must be an array of strings.`);
    }

    const allowed = new Set((question.options ?? []).map((option) => option.label));
    const values = rawValues.map((value) => value.trim()).filter(Boolean);
    if (values.length > 1) {
      throw new Error(`Answer for question "${questionId}" must contain at most one value.`);
    }
    for (const value of values) {
      if (question.options && !allowed.has(value) && !question.isOther) {
        throw new Error(`Answer for question "${questionId}" is not an allowed option.`);
      }
    }
    output[questionId] = { answers: values };
  }

  return { answers: output };
}

function normalizeFileSystemPermissions(
  permissions: CodexAdditionalFileSystemPermissions | null,
): CodexAdditionalFileSystemPermissions | undefined {
  if (!permissions) {
    return undefined;
  }
  for (const [field, roots] of [
    ['read', permissions.read],
    ['write', permissions.write],
  ] as const) {
    if (roots !== null && (
      !Array.isArray(roots) || roots.some((root) => typeof root !== 'string' || !root.trim())
    )) {
      throw new Error(`Codex requested malformed file-system ${field} roots.`);
    }
  }
  if (
    permissions.globScanMaxDepth !== undefined
    && (
      !Number.isSafeInteger(permissions.globScanMaxDepth)
      || permissions.globScanMaxDepth < 0
    )
  ) {
    throw new Error('Codex requested an invalid file-system glob scan depth.');
  }

  return {
    read: permissions.read,
    write: permissions.write,
    ...(permissions.globScanMaxDepth === undefined
      ? {}
      : { globScanMaxDepth: permissions.globScanMaxDepth }),
  };
}

function grantedPermissions(
  requested: CodexRequestPermissionProfile,
  allow: boolean,
): {
  network?: { enabled: boolean | null };
  fileSystem?: CodexAdditionalFileSystemPermissions;
} {
  if (!allow) {
    return {};
  }
  return {
    ...(requested.network ? { network: { enabled: requested.network.enabled } } : {}),
    ...(normalizeFileSystemPermissions(requested.fileSystem)
      ? { fileSystem: normalizeFileSystemPermissions(requested.fileSystem) }
      : {}),
  };
}

function validatePermissionProfile(
  requested: CodexRequestPermissionProfile,
): void {
  if (
    requested.network !== null
    && (
      !requested.network
      || !(
        typeof requested.network.enabled === 'boolean'
        || requested.network.enabled === null
      )
    )
  ) {
    throw new Error('Codex requested malformed network permissions.');
  }
  normalizeFileSystemPermissions(requested.fileSystem);
}

export class CodexAppServerChatTransport {
  private readonly options: AppServerChatOptions;
  private client: JsonlRpcClient | null = null;
  private startup: Promise<JsonlRpcClient> | null = null;
  private readonly activeTurns = new Map<string, ActiveTurn>();

  constructor(options: AppServerChatOptions = {}) {
    this.options = options;
  }

  async query(
    command: string,
    options: QueryCodexAppServerOptions,
    writer: AppServerWriter,
  ): Promise<void> {
    const client = await this.ensureClient();
    const workingDirectory = options.cwd || options.projectPath || process.cwd();
    let resolvedModel = await providerModelsService.resolveResumeModel(
      PROVIDER,
      options.sessionId,
      options.model,
    );
    if (options.permissionMode === 'plan' && !resolvedModel) {
      resolvedModel = (await providerModelsService.getProviderModels(PROVIDER)).models.DEFAULT;
    }
    const resolvedEffort = normalizeEffort(options.effort);
    const permissions = mapCodexAppServerPermissionMode(options.permissionMode);

    // Only a provider-native id can address a rollout on disk. A brand-new
    // session has none, which is exactly what makes `thread/start` correct.
    const resumeThreadId = readNonEmptyString(options.providerSessionId);
    let threadId = resumeThreadId || '';
    let active: ActiveTurn | null = null;

    try {
      let threadResponse: CodexThreadResponse;
      const rewindToMessageId = readNonEmptyString(options.rewindToMessageId);
      if (resumeThreadId && rewindToMessageId) {
        threadResponse = await client.request<CodexThreadForkResponse>('thread/fork', {
          threadId: resumeThreadId,
          beforeTurnId: rewindToMessageId,
          model: resolvedModel,
          cwd: workingDirectory,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: 'user',
          sandbox: permissions.sandboxMode,
        });
      } else if (resumeThreadId) {
        threadResponse = await client.request<CodexThreadResponse>('thread/resume', {
          threadId: resumeThreadId,
          model: resolvedModel,
          cwd: workingDirectory,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: 'user',
          sandbox: permissions.sandboxMode,
        });
      } else {
        threadResponse = await client.request<CodexThreadResponse>('thread/start', {
          model: resolvedModel,
          cwd: workingDirectory,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: 'user',
          sandbox: permissions.sandboxMode,
        });
      }

      threadId = readNonEmptyString(threadResponse?.thread?.id) || '';
      if (!threadId) {
        throw new Error('Codex App Server returned a thread without an id.');
      }
      resolvedModel ||= readNonEmptyString(threadResponse.model) || undefined;
      if (!resolvedModel) {
        throw new Error('Codex App Server returned a thread without a model.');
      }
      writer.setSessionId?.(threadId, {
        jsonlPath: threadResponse.thread.path,
        projectPath: threadResponse.thread.cwd || workingDirectory,
      });

      let resolveDone = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      active = {
        threadId,
        appSessionId: readNonEmptyString(options.sessionId) || null,
        turnId: null,
        writer,
        done,
        resolveDone,
        terminal: false,
        aborted: false,
        fileChanges: new Map(),
        userId: writer.userId ?? null,
        sessionName: readNonEmptyString(options.sessionSummary),
      };
      this.activeTurns.set(threadId, active);

      const turnResponse = await client.request<CodexTurnStartResponse>('turn/start', {
        threadId,
        input: toCodexInput(command, options.images, workingDirectory),
        cwd: workingDirectory,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: 'user',
        sandboxPolicy: permissions.sandboxPolicy,
        model: resolvedModel,
        effort: resolvedEffort,
        collaborationMode: {
          mode: options.permissionMode === 'plan' ? 'plan' : 'default',
          settings: {
            model: resolvedModel,
            reasoning_effort: resolvedEffort ?? null,
            developer_instructions: null,
          },
        },
      });

      active.turnId = readNonEmptyString(turnResponse?.turn?.id);
      if (!active.turnId) {
        throw new Error('Codex App Server returned a turn without an id.');
      }

      if (turnResponse.turn.status !== 'inProgress') {
        this.finishTurn(active, turnResponse.turn);
      }
      await active.done;
    } catch (error) {
      if (active && !active.terminal) {
        this.emitError(active, error);
        this.finishTurn(active, {
          id: active.turnId || '',
          status: active.aborted ? 'interrupted' : 'failed',
          error: active.aborted
            ? null
            : { message: error instanceof Error ? error.message : String(error) },
        });
      } else if (!active) {
        const content = error instanceof Error ? error.message : String(error);
        writer.send(createNormalizedMessage({
          kind: 'error',
          content,
          sessionId: threadId || options.sessionId || null,
          provider: PROVIDER,
        }));
        writer.send(createCompleteMessage({
          provider: PROVIDER,
          sessionId: threadId || options.sessionId || null,
          exitCode: 1,
        }));
        (this.options.notifyRunFailed ?? defaultNotifyRunFailed)({
          userId: writer.userId ?? null,
          provider: PROVIDER,
          sessionId: threadId || options.sessionId || null,
          sessionName: readNonEmptyString(options.sessionSummary),
          error,
        });
      }
    } finally {
      if (active && this.activeTurns.get(threadId) === active) {
        this.activeTurns.delete(threadId);
      }
    }
  }

  /**
   * Finds a run by either id it answers to.
   *
   * The chat gateway addresses runs by the app session id; `forkThread` and
   * direct API callers address them by the Codex thread id. Matching both keeps
   * one lookup honest for all of them.
   */
  private findActiveTurn(sessionId: string): ActiveTurn | null {
    const byThread = this.activeTurns.get(sessionId);
    if (byThread) {
      return byThread;
    }
    for (const turn of this.activeTurns.values()) {
      if (turn.appSessionId && turn.appSessionId === sessionId) {
        return turn;
      }
    }
    return null;
  }

  async abort(sessionId: string): Promise<boolean> {
    const active = this.findActiveTurn(sessionId);
    const client = this.client;
    if (!active || !active.turnId || !client?.isOpen) {
      return false;
    }

    active.aborted = true;
    try {
      await client.request('turn/interrupt', {
        threadId: active.threadId,
        turnId: active.turnId,
      });
      // Pending interactions are registered under the app session id, so the
      // cancel has to use the same key the register did.
      await interactiveRequestRegistry.cancelForSession(active.appSessionId || active.threadId);
      return true;
    } catch (error) {
      active.aborted = false;
      console.warn(`[Codex App Server] Failed to interrupt thread ${active.threadId}:`, error);
      return false;
    }
  }

  /**
   * Creates an intentional sibling thread without starting a turn.
   *
   * This is distinct from query-time rewind: the caller allocates a new stable
   * CLIde session for this provider thread while preserving the source row.
   */
  async forkThread(
    threadId: string,
    options: ForkCodexThreadOptions = {},
  ): Promise<CodexThread> {
    if (this.isActive(threadId)) {
      throw new Error('Cannot fork a Codex thread while its turn is still running.');
    }

    const client = await this.ensureClient();
    const workingDirectory = options.cwd || process.cwd();
    const resolvedModel = await providerModelsService.resolveResumeModel(
      PROVIDER,
      threadId,
      options.model,
    );
    const permissions = mapCodexAppServerPermissionMode(options.permissionMode);
    const lastTurnId = readNonEmptyString(options.lastTurnId);
    const response = await client.request<CodexThreadForkResponse>('thread/fork', {
      threadId,
      model: resolvedModel,
      cwd: workingDirectory,
      approvalPolicy: permissions.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: permissions.sandboxMode,
      ...(lastTurnId ? { lastTurnId } : {}),
    });
    const forkedThreadId = readNonEmptyString(response?.thread?.id);
    if (!forkedThreadId) {
      throw new Error('Codex App Server returned a fork without a thread id.');
    }
    return response.thread;
  }

  isActive(sessionId: string): boolean {
    const active = this.findActiveTurn(sessionId);
    return Boolean(active && !active.terminal);
  }

  closeForTests(): void {
    this.client?.close('Codex App Server Chat transport closed for tests.');
    this.client = null;
    this.startup = null;
    this.activeTurns.clear();
  }

  private async ensureClient(): Promise<JsonlRpcClient> {
    if (this.client?.isOpen) {
      return this.client;
    }
    if (this.startup) {
      return this.startup;
    }

    this.startup = (async () => {
      const client = new JsonlRpcClient({
        command: this.options.command ?? resolveBundledCodexAppServerCommand(),
        requestTimeoutMs: this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
        onNotification: (method, params) => {
          this.handleNotification(method, params);
        },
        onServerRequest: async (request) => {
          await this.handleServerRequest(request.id, request.method, request.params);
        },
        onExit: (error) => {
          if (this.client === client) {
            this.client = null;
          }
          if (this.options.trackRuntimeState) {
            markCodexAppServerStopped(error);
          }
          this.failActiveTurns(error);
        },
      });

      try {
        if (this.options.trackRuntimeState) {
          markCodexAppServerStarting();
        }
        client.open();
        await client.request('initialize', {
          clientInfo: {
            name: 'clide',
            title: 'CLIde',
            version: '1',
          },
          capabilities: {
            experimentalApi: true,
          },
        }, STARTUP_TIMEOUT_MS);
        client.notify('initialized', {});
        this.client = client;
        if (this.options.trackRuntimeState) {
          markCodexAppServerReady();
        }
        return client;
      } catch (error) {
        client.close('Codex App Server initialization failed.');
        const startupError = new CodexAppServerStartupError(
          `Unable to initialize Codex App Server: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
        if (this.options.trackRuntimeState) {
          markCodexAppServerStartupFallback(startupError);
        }
        throw startupError;
      } finally {
        this.startup = null;
      }
    })();

    return this.startup;
  }

  private handleNotification(method: string, value: unknown): void {
    const params = readObjectRecord(value);
    const threadId = readNonEmptyString(params?.threadId);
    if (!params || !threadId) {
      return;
    }

    const active = this.activeTurns.get(threadId);

    switch (method as CodexNotification['method']) {
      case 'item/started': {
        const item = readObjectRecord(params.item);
        if (active && item?.type === 'fileChange' && typeof item.id === 'string') {
          active.fileChanges.set(item.id, item.changes);
        }
        return;
      }
      case 'item/completed': {
        if (!active || active.terminal) {
          return;
        }
        const item = params.item as CodexThreadItem;
        if (!item || typeof item !== 'object' || typeof item.type !== 'string' || typeof item.id !== 'string') {
          return;
        }
        if (item.type === 'fileChange') {
          active.fileChanges.set(item.id, item.changes);
        }
        for (const message of completedItemMessages(item, threadId)) {
          active.writer.send(message);
        }
        return;
      }
      case 'thread/tokenUsage/updated': {
        if (!active || active.terminal) {
          return;
        }
        const tokenUsage = params.tokenUsage as CodexTokenUsage;
        if (!tokenUsage?.last) {
          return;
        }
        active.writer.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget: tokenBudgetFromUsage(tokenUsage),
          sessionId: threadId,
          provider: PROVIDER,
        }));
        return;
      }
      case 'turn/completed': {
        if (!active) {
          return;
        }
        this.finishTurn(active, params.turn as CodexTurn);
        return;
      }
      case 'serverRequest/resolved': {
        const requestId = params.requestId;
        if (typeof requestId === 'string' || typeof requestId === 'number') {
          void interactiveRequestRegistry.markServerResolved(toExternalRequestId(requestId));
        }
        return;
      }
      case 'error': {
        if (active && !active.terminal) {
          this.emitError(active, params.error || params.message || 'Codex App Server error');
        }
        return;
      }
      default:
        return;
    }
  }

  private async handleServerRequest(
    rpcId: JsonlRpcId,
    method: string,
    value: unknown,
  ): Promise<void> {
    const client = this.client;
    if (!client?.isOpen) {
      return;
    }

    try {
      switch (method) {
        case 'item/tool/requestUserInput':
          this.registerUserInputRequest(rpcId, value as CodexToolRequestUserInputParams);
          return;
        case 'item/commandExecution/requestApproval':
          this.registerCommandApproval(rpcId, value as CodexCommandApprovalParams);
          return;
        case 'item/fileChange/requestApproval':
          this.registerFileChangeApproval(rpcId, value as CodexFileChangeApprovalParams);
          return;
        case 'item/permissions/requestApproval':
          this.registerPermissionsApproval(rpcId, value as CodexPermissionsApprovalParams);
          return;
        default:
          client.respondError(rpcId, -32601, `CLIde does not support App Server request "${method}".`);
      }
    } catch (error) {
      client.respondError(
        rpcId,
        -32602,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private requireActiveRequest(
    threadId: unknown,
    turnId: unknown,
  ): ActiveTurn {
    const normalizedThreadId = readNonEmptyString(threadId);
    const normalizedTurnId = readNonEmptyString(turnId);
    const active = normalizedThreadId ? this.activeTurns.get(normalizedThreadId) : null;
    if (
      !active
      || active.terminal
      || !normalizedTurnId
      || (active.turnId && active.turnId !== normalizedTurnId)
    ) {
      throw new Error('App Server request does not belong to an active CLIde turn.');
    }
    return active;
  }

  private registerUserInputRequest(
    rpcId: JsonlRpcId,
    params: CodexToolRequestUserInputParams,
  ): void {
    const active = this.requireActiveRequest(params?.threadId, params?.turnId);
    const questions = validateQuestions(params?.questions);
    const autoResolutionMs = typeof params.autoResolutionMs === 'number'
      && Number.isFinite(params.autoResolutionMs)
      && params.autoResolutionMs > 0
      ? Math.floor(params.autoResolutionMs)
      : null;
    const requestId = toExternalRequestId(rpcId);
    const receivedAt = new Date();

    interactiveRequestRegistry.register({
      requestId,
      provider: PROVIDER,
      // Registered under the app session id so `chat.subscribe` can replay a
      // pending prompt after a refresh, matching the other runtimes.
      sessionId: active.appSessionId || active.threadId,
      requestType: 'user_input',
      toolName: 'request_user_input',
      toolId: readNonEmptyString(params.itemId) || undefined,
      questions: questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        options: question.options ?? [],
        allowOther: question.isOther,
        isSecret: question.isSecret,
        multiSelect: false,
      })),
      input: {
        questions: questions.map((question) => ({
          id: question.id,
          header: question.header,
          question: question.question,
          options: question.options ?? [],
          allowOther: question.isOther,
          isSecret: question.isSecret,
          multiSelect: false,
        })),
      },
      receivedAt: receivedAt.toISOString(),
      autoResolutionMs,
      expiresAt: autoResolutionMs
        ? new Date(receivedAt.getTime() + autoResolutionMs).toISOString()
        : null,
    }, {
      timeoutMs: autoResolutionMs ?? 0,
      onResponse: (response) => {
        this.client?.respond(rpcId, validateQuestionAnswers(questions, response));
      },
      onTimeout: () => {
        this.client?.respond(rpcId, { answers: {} });
      },
      onCancel: () => {
        this.client?.respond(rpcId, { answers: {} });
      },
      onSettled: () => {
        active.writer.send(createNormalizedMessage({
          kind: 'permission_cancelled',
          requestId,
          reason: 'resolved',
          sessionId: active.threadId,
          provider: PROVIDER,
        }));
      },
    });

    const itemId = readNonEmptyString(params.itemId) || requestId;
    active.writer.send(createNormalizedMessage({
      id: itemId,
      kind: 'tool_use',
      toolName: 'request_user_input',
      toolId: itemId,
      toolInput: interactiveRequestRegistry.get(requestId)?.input,
      sessionId: active.threadId,
      provider: PROVIDER,
    }));
    active.writer.send(createNormalizedMessage({
      kind: 'permission_request',
      requestId,
      requestType: 'user_input',
      toolName: 'request_user_input',
      toolId: itemId,
      input: interactiveRequestRegistry.get(requestId)?.input,
      questions: interactiveRequestRegistry.get(requestId)?.questions,
      autoResolutionMs,
      expiresAt: interactiveRequestRegistry.get(requestId)?.expiresAt,
      sessionId: active.threadId,
      provider: PROVIDER,
    }));
  }

  private registerCommandApproval(
    rpcId: JsonlRpcId,
    params: CodexCommandApprovalParams,
  ): void {
    const active = this.requireActiveRequest(params?.threadId, params?.turnId);
    const requestId = toExternalRequestId(rpcId);
    const command = readNonEmptyString(params.command);
    if (!readNonEmptyString(params.itemId) || !command) {
      throw new Error('Codex command approval is missing itemId or command.');
    }

    this.registerApproval(active, rpcId, requestId, {
      requestType: 'command_approval',
      toolName: 'Bash',
      input: {
        command,
        cwd: params.cwd || null,
        reason: params.reason || null,
        networkDestination: params.networkApprovalContext || null,
      },
    }, (decision) => ({
      decision: mapApprovalDecision(decision),
    }));
  }

  private registerFileChangeApproval(
    rpcId: JsonlRpcId,
    params: CodexFileChangeApprovalParams,
  ): void {
    const active = this.requireActiveRequest(params?.threadId, params?.turnId);
    const requestId = toExternalRequestId(rpcId);
    const itemId = readNonEmptyString(params.itemId);
    if (!itemId) {
      throw new Error('Codex file-change approval is missing itemId.');
    }

    this.registerApproval(active, rpcId, requestId, {
      requestType: 'file_change_approval',
      toolName: 'FileChanges',
      input: {
        reason: params.reason || null,
        requestedRoot: params.grantRoot || null,
        changes: active.fileChanges.get(itemId) || null,
      },
    }, (decision) => ({
      decision: mapApprovalDecision(decision),
    }));
  }

  private registerPermissionsApproval(
    rpcId: JsonlRpcId,
    params: CodexPermissionsApprovalParams,
  ): void {
    const active = this.requireActiveRequest(params?.threadId, params?.turnId);
    const requestId = toExternalRequestId(rpcId);
    const permissionRecord = readObjectRecord(params?.permissions);
    if (
      !readNonEmptyString(params?.itemId)
      || !permissionRecord
      || !('network' in permissionRecord)
      || !('fileSystem' in permissionRecord)
    ) {
      throw new Error('Codex permission approval is missing itemId or permissions.');
    }
    const requestedPermissions = params.permissions;
    validatePermissionProfile(requestedPermissions);

    this.registerApproval(active, rpcId, requestId, {
      requestType: 'permission_approval',
      toolName: 'Permissions',
      input: {
        cwd: params.cwd,
        reason: params.reason,
        permissions: requestedPermissions,
      },
    }, (decision) => ({
      permissions: grantedPermissions(
        requestedPermissions,
        decision === 'allow_once' || decision === 'allow_session',
      ),
      scope: decision === 'allow_session' ? 'session' : 'turn',
    }));
  }

  private registerApproval(
    active: ActiveTurn,
    rpcId: JsonlRpcId,
    requestId: string,
    request: {
      requestType: 'command_approval' | 'file_change_approval' | 'permission_approval';
      toolName: string;
      input: unknown;
    },
    buildResponse: (decision: InteractiveRequestDecision) => unknown,
  ): void {
    interactiveRequestRegistry.register({
      requestId,
      provider: PROVIDER,
      // See the user-input registration above: app session id, not thread id.
      sessionId: active.appSessionId || active.threadId,
      requestType: request.requestType,
      toolName: request.toolName,
      input: request.input,
      receivedAt: new Date().toISOString(),
      expiresAt: null,
      autoResolutionMs: null,
    }, {
      onResponse: (response) => {
        if (response.requestType && response.requestType !== request.requestType) {
          throw new Error('Interactive response requestType does not match the pending request.');
        }
        this.client?.respond(rpcId, buildResponse(readDecision(response)));
      },
      onCancel: () => {
        this.client?.respond(rpcId, buildResponse('cancel'));
      },
      onSettled: () => {
        active.writer.send(createNormalizedMessage({
          kind: 'permission_cancelled',
          requestId,
          reason: 'resolved',
          sessionId: active.threadId,
          provider: PROVIDER,
        }));
      },
    });

    active.writer.send(createNormalizedMessage({
      kind: 'permission_request',
      requestId,
      requestType: request.requestType,
      toolName: request.toolName,
      input: request.input,
      sessionId: active.threadId,
      provider: PROVIDER,
    }));
  }

  private finishTurn(active: ActiveTurn, turn: CodexTurn): void {
    if (active.terminal) {
      return;
    }
    active.terminal = true;

    const failed = turn?.status === 'failed';
    if (failed && turn.error?.message) {
      this.emitError(active, turn.error.message);
    }

    // The websocket gateway emits the abort completion itself immediately
    // after abort() succeeds. Avoid racing it; its exactly-once guard remains
    // the final safety net for a late interrupted notification.
    if (!active.aborted) {
      active.writer.send(createCompleteMessage({
        provider: PROVIDER,
        sessionId: active.threadId,
        actualSessionId: active.threadId,
        exitCode: failed ? 1 : 0,
      }));
      if (failed) {
        (this.options.notifyRunFailed ?? defaultNotifyRunFailed)({
          userId: active.userId,
          provider: PROVIDER,
          sessionId: active.threadId,
          sessionName: active.sessionName,
          error: turn.error?.message || 'Codex App Server turn failed.',
        });
      } else {
        (this.options.notifyRunStopped ?? defaultNotifyRunStopped)({
          userId: active.userId,
          provider: PROVIDER,
          sessionId: active.threadId,
          sessionName: active.sessionName,
          stopReason: 'completed',
        });
      }
    }
    active.resolveDone();
  }

  private emitError(active: ActiveTurn, error: unknown): void {
    const content = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
    active.writer.send(createNormalizedMessage({
      kind: 'error',
      content: content || 'Codex App Server error',
      sessionId: active.threadId,
      provider: PROVIDER,
    }));
  }

  private failActiveTurns(error: Error): void {
    for (const active of this.activeTurns.values()) {
      if (active.terminal) {
        continue;
      }
      this.emitError(active, error);
      this.finishTurn(active, {
        id: active.turnId || '',
        status: 'failed',
        error: { message: error.message },
      });
    }
    this.activeTurns.clear();
  }
}

const sharedTransport = new CodexAppServerChatTransport({
  trackRuntimeState: true,
});

export async function queryCodexAppServer(
  command: string,
  options: QueryCodexAppServerOptions,
  writer: AppServerWriter,
): Promise<void> {
  return sharedTransport.query(command, options, writer);
}

export function abortCodexAppServerSession(threadId: string): Promise<boolean> {
  return sharedTransport.abort(threadId);
}

export function isCodexAppServerSessionActive(threadId: string): boolean {
  return sharedTransport.isActive(threadId);
}

export function forkCodexAppServerThread(
  threadId: string,
  options: ForkCodexThreadOptions = {},
): Promise<CodexThread> {
  return sharedTransport.forkThread(threadId, options);
}
