import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { getProviderSessionEffort, providerCapabilitiesService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import {
  getGlobalImageAssetsDir,
  isImageAttachmentDescriptor,
  normalizeAttachmentDescriptors,
  type ChatAttachmentDescriptor,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  InteractiveRequestResponse,
  LLMProvider,
  ProviderInteractiveResolution,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.cloudcli/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterAttachmentsToUploadStore(
  attachments: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeAttachmentDescriptors(attachments).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping attachment outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/** Backward-compatible image filter consumed by existing websocket tests. */
export function filterImagesToUploadStore(
  images: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  return filterAttachmentsToUploadStore(images, assetsRootOverride);
}

/** Application boundary for dispatching provider runs and approvals. */
type ProviderRuntimeGateway = {
  hasRuntime(provider: string): boolean;
  run(
    provider: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown>;
  /**
   * Addressed with the stable app session id. Runtimes key their process and
   * approval maps by the id the caller hands them, which since v1.37 is the app
   * one — and unlike the provider id it exists from the first message, so an
   * early Stop is addressable.
   */
  abort(provider: LLMProvider, appSessionId: string): Promise<boolean>;
  resolveInteractiveRequest(
    requestId: string,
    response: InteractiveRequestResponse,
  ): Promise<ProviderInteractiveResolution>;
  /** Provider-neutral pending requests, keyed by app session id. */
  getPendingApprovalsForSession(appSessionId: string): unknown[];
};

type ChatWebSocketDependencies = {
  /** Central dispatcher for every provider SDK/CLI runtime. */
  runtime: ProviderRuntimeGateway;
};

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return;
  }

  const provider = session.provider as LLMProvider;
  if (!dependencies.runtime.hasRuntime(provider)) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  // Rewind is gated on the capability matrix, not the provider id: runtimes that
  // never read rewindToMessageId must never receive it.
  const requestedRewindId = (data.options as AnyRecord | undefined)?.rewindToMessageId;
  if (
    requestedRewindId !== undefined &&
    !providerCapabilitiesService.getProviderCapabilities(provider)?.supportsRewind
  ) {
    sendProtocolError(
      ws,
      'REWIND_UNSUPPORTED',
      `Provider "${provider}" does not support rewinding to an earlier message.`,
      sessionId
    );
    return;
  }

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const command = typeof data.content === 'string' ? data.content : '';

  const attachmentCandidates = [
    ...normalizeAttachmentDescriptors(clientOptions.images),
    ...normalizeAttachmentDescriptors(clientOptions.files),
    ...normalizeAttachmentDescriptors(clientOptions.attachments),
  ];
  const verifiedAttachments = filterAttachmentsToUploadStore(attachmentCandidates);
  const uniqueAttachments = verifiedAttachments.filter(
    (descriptor, index, all) => all.findIndex((candidate) => candidate.path === descriptor.path) === index,
  );

  // The provider runtimes receive the stable app session id. When their
  // CLI/SDK needs the provider-native id for resume, they resolve it from the
  // session row themselves (sessionsService.resolveProviderSessionId).
  // Brand-new sessions have no provider id yet, so the runtime starts fresh
  // and announces one, which the gateway writer captures and maps back to the
  // app session id.
  // The composer sends an effort only when it knows this session's own; an
  // unresolved one omits it rather than leaking the provider-level seed that
  // every session on a provider shares. Resolve the gap here, from the stored
  // pick weighed against the provider's own turn evidence.
  const clientEffort = typeof clientOptions.effort === 'string' && clientOptions.effort.trim()
    ? clientOptions.effort.trim()
    : null;
  const resolvedEffort = clientEffort
    ?? (await getProviderSessionEffort(provider, sessionId)).effort
    ?? undefined;

  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    effort: resolvedEffort,
    // Attachments are re-validated server-side: only direct children of the
    // global upload store may reach provider runtimes or their file tools.
    attachments: uniqueAttachments,
    images: uniqueAttachments.filter(isImageAttachmentDescriptor),
    files: uniqueAttachments.filter((descriptor) => !isImageAttachmentDescriptor(descriptor)),
    sessionId,
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
    // Lets the runtime read the provider transcript (rewind anchor lookup)
    // without re-deriving the path; runtimes with no use for it ignore it.
    jsonlPath: session.jsonl_path ?? undefined,
    // Cancellation that does not depend on the provider session id existing.
    // `chat.abort` can only address a runtime by its provider-native id, which
    // is unknown until the runtime announces it mid-stream and `null` for the
    // whole first leg of a new session. Runtimes that honor this signal cancel
    // whenever the abort lands; ones that ignore it keep id-keyed behaviour.
    abortController: run.abortController,
  };

  try {
    await dependencies.runtime.run(provider, command, runtimeOptions, run.writer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
  } finally {
    // Safety net: a runtime that crashed (or resolved) without emitting its
    // terminal `complete` would otherwise leave the session stuck in
    // "processing" forever on every connected client. Scoped to THIS run —
    // a queued message can start the session's next run before this promise
    // settles, and the session-keyed completeRun would kill that new run.
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
  }
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  // `beginAbort` (not `getRun`) is the guard: it atomically claims the abort and
  // flips `abortInFlight` in one synchronous step. A run only flips to
  // `completed` after the awaited interrupt below resolves, so a second
  // `chat.abort` — a mashed Stop, or two listeners firing for one Escape — can
  // arrive while `status` is still `running`. Without the claim, both race their
  // own interrupt against the same CLI process, which corrupts its response
  // stream (garbled result, `stop_reason: null`) instead of stopping cleanly.
  const run = chatRunRegistry.beginAbort(sessionId);
  if (!run) {
    // Distinguish "nothing to abort" from "already aborting": the client renders
    // every protocol_error as a visible message, and a duplicate Stop is not an
    // error — the first abort resolves this run momentarily.
    const existing = chatRunRegistry.getRun(sessionId);
    if (!existing || existing.status !== 'running') {
      sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    }
    return;
  }

  // Two-tier cancellation. `beginAbort` has already tripped the run's
  // AbortController, which the runtime was handed at spawn — the tier that
  // always applies, and the only one Cursor and OpenCode have.
  //
  // The id-keyed abort is still preferred: it is the provider's graceful
  // interrupt, which unwinds the CLI/SDK cleanly and flushes partial output,
  // where the signal is a blunter cancel. It is addressed by the *app* session
  // id — registered by every runtime since v1.37, and present from the first
  // message, so it no longer misses a new session's opening leg.
  //
  // Exit code 0 is "we cancelled this run"; only an interrupt attempted and
  // refused is a genuine failure.
  const interruptFailed = !(await dependencies.runtime.abort(run.provider, sessionId));

  chatRunRegistry.completeRun(sessionId, {
    exitCode: interruptFailed ? 1 : 0,
    aborted: true,
  });
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq when the client's runId matches the current run; the
 * full buffer otherwise), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    // Which run the client's `lastSeq` was recorded against — `seq` restarts per
    // run, so replay only honors the counter when the runs match.
    const clientRunId = typeof (target as AnyRecord).runId === 'string'
      ? ((target as AnyRecord).runId as string)
      : null;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);

    // Future live events for this run should land on the socket that asked —
    // this is what makes mid-stream page refreshes work for all providers.
    if (isProcessing) {
      chatRunRegistry.attachConnection(sessionId, ws);
    }

    // Runtimes register pending interactions under the app session id, so this
    // resolves before the provider has announced one of its own — exactly when a
    // mid-approval refresh used to lose the prompt. The sessionId is restamped
    // so a runtime keying by its own id cannot leak one to the client.
    const pendingPermissions = dependencies.runtime
      .getPendingApprovalsForSession(sessionId)
      .map((approval) =>
      approval && typeof approval === 'object'
        ? { ...(approval as AnyRecord), sessionId }
        : approval,
    );

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      runId: run?.runId ?? null,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq, clientRunId)) {
        sendJson(ws, event);
      }
    }
  }
}

/**
 * Handles `chat.ping`: application-level liveness echo for the client's
 * half-open-connection watchdog.
 *
 * Browsers answer WS protocol pings inside the network stack, so client-side
 * dead-connection detection needs an echo that travels as a normal data frame.
 * Missing the `chat_pong` (or any frame) within the watchdog window makes the
 * client force-close and reconnect. `ts` is echoed untouched so it can match
 * responses and estimate round-trip latency.
 */
function handleChatPing(ws: WebSocket, data: AnyRecord): void {
  sendJson(ws, {
    kind: 'chat_pong',
    ts: typeof data.ts === 'number' ? data.ts : null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * provider-neutral pending interaction registry.
 */
async function handlePermissionResponse(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
): Promise<void> {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    sendProtocolError(ws, 'REQUEST_ID_REQUIRED', 'chat.permission-response requires a requestId.');
    return;
  }

  const validRequestTypes = new Set([
    'tool_approval',
    'user_input',
    'command_approval',
    'file_change_approval',
    'permission_approval',
  ]);
  if (data.requestType !== undefined && (
    typeof data.requestType !== 'string' || !validRequestTypes.has(data.requestType)
  )) {
    sendProtocolError(ws, 'INTERACTIVE_RESPONSE_INVALID', 'Unsupported interactive requestType.');
    return;
  }

  const validDecisions = new Set(['allow_once', 'allow_session', 'deny', 'cancel']);
  if (data.decision !== undefined && (
    typeof data.decision !== 'string' || !validDecisions.has(data.decision)
  )) {
    sendProtocolError(ws, 'INTERACTIVE_RESPONSE_INVALID', 'Unsupported interactive decision.');
    return;
  }

  if (data.answers !== undefined) {
    if (!data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
      sendProtocolError(ws, 'INTERACTIVE_RESPONSE_INVALID', 'Interactive answers must be keyed arrays.');
      return;
    }
    const malformedAnswer = Object.values(data.answers as AnyRecord).some((answer) =>
      !Array.isArray(answer) || answer.some((value) => typeof value !== 'string')
    );
    if (malformedAnswer) {
      sendProtocolError(ws, 'INTERACTIVE_RESPONSE_INVALID', 'Each interactive answer must be an array of strings.');
      return;
    }
  }

  const result = await dependencies.runtime.resolveInteractiveRequest(data.requestId, {
    allow: Boolean(data.allow),
    requestType: typeof data.requestType === 'string' ? data.requestType as InteractiveRequestResponse['requestType'] : undefined,
    decision: typeof data.decision === 'string' ? data.decision as InteractiveRequestResponse['decision'] : undefined,
    answers: data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers)
      ? data.answers as Record<string, string[]>
      : undefined,
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });

  if (result.status === 'not_found') {
    sendProtocolError(
      ws,
      'INTERACTIVE_REQUEST_STALE',
      `Interactive request "${data.requestId}" is no longer pending.`,
    );
  } else if (result.status === 'invalid') {
    sendProtocolError(
      ws,
      'INTERACTIVE_RESPONSE_INVALID',
      result.error || 'Interactive response was rejected.',
    );
  }
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq?, runId? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 * - `chat.ping`                { ts? } — liveness probe; echoed as `chat_pong`
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `runId` + per-run `seq`) or a gateway
 * event (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`, `chat_pong`).
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = readRequestUserId(request);

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';

      switch (messageType) {
        case 'chat.send':
          await handleChatSend(ws, userId, data, dependencies);
          return;
        case 'chat.abort':
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
          return;
        case 'chat.permission-response':
          await handlePermissionResponse(ws, data, dependencies);
          return;
        case 'chat.ping':
          handleChatPing(ws, data);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    connectedClients.delete(ws);
  });
}
