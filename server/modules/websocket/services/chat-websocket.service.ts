import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { providerCapabilitiesService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { getGlobalImageAssetsDir, normalizeImageDescriptors } from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  InteractiveRequestResponse,
  LLMProvider,
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
export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeImageDescriptors(images).filter((descriptor) => {
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
      console.warn(`[Chat] Dropping image outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/**
 * One provider runtime entry point. All five runtimes share this signature,
 * which lets the chat handler dispatch through a provider-keyed map instead
 * of provider-specific branches.
 */
type ProviderSpawnFn = (
  command: string,
  options: AnyRecord,
  writer: unknown
) => Promise<unknown>;

type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions keyed by provider id. They are addressed with the
   * provider-native session id (that is how runtimes key their process maps).
   * The Claude abort is async; the rest are sync — both shapes are accepted.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  resolveInteractiveRequest: (
    requestId: string,
    payload: InteractiveRequestResponse,
  ) => Promise<{
    status: 'resolved' | 'not_found' | 'invalid';
    error?: string;
  }>;
  /** Provider-neutral pending requests included in `chat_subscribed`. */
  getPendingInteractiveRequestsForSession: (providerSessionId: string) => unknown[];
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
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  // Rewind is gated on the capability matrix, not the provider id: runtimes
  // that never look at rewindToMessageId must never receive it.
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

  // The provider runtimes receive the provider-native session id (that is the
  // id their CLI/SDK understands for resume). Brand-new sessions have no
  // provider id yet, so the runtime starts fresh and announces one, which the
  // gateway writer captures and maps back to the app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    // Image attachments are re-validated server-side: only files inside the
    // global upload store may reach the provider runtimes' file reads.
    images: filterImagesToUploadStore(clientOptions.images),
    sessionId: session.provider_session_id ?? undefined,
    resume: Boolean(session.provider_session_id),
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
    // Lets the runtime read the provider transcript (rewind anchor lookup)
    // without re-deriving the path; runtimes without a use for it ignore it.
    jsonlPath: session.jsonl_path ?? undefined,
    // Cancellation that does not depend on the provider session id existing.
    // `chat.abort` can only address a runtime by its provider-native id, which
    // is unknown until the runtime announces it mid-stream (and is `null` for
    // the entire first leg of a brand-new session) — so an early Stop had
    // nothing to interrupt and the run completed anyway. Runtimes that honor
    // this signal cancel correctly no matter when the abort lands; ones that
    // ignore it keep the previous id-keyed behavior.
    abortController: run.abortController,
  };

  try {
    await spawnFn(command, runtimeOptions, run.writer);
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

  // `beginAbort` (not `getRun`) is the guard: it atomically claims the abort
  // and flips `abortInFlight` in one synchronous step. A run only flips to
  // `completed` after the awaited provider interrupt below resolves, so a
  // second `chat.abort` for the same run — e.g. a mashed Stop button, or two
  // listeners each firing once for the same Escape press — can arrive while
  // `status` is still `running`. Without this claim, both calls would race
  // their own concurrent interrupt request against the same underlying CLI
  // process, which has been observed to corrupt its response stream instead
  // of cleanly stopping it (a garbled result with `stop_reason: null`).
  const run = chatRunRegistry.beginAbort(sessionId);
  if (!run) {
    // Distinguish "nothing to abort" from "already being aborted": the
    // client renders every protocol_error as a visible chat message, and a
    // duplicate Stop click is not an error — the first abort's own
    // completion will resolve this run momentarily.
    const existing = chatRunRegistry.getRun(sessionId);
    if (!existing || existing.status !== 'running') {
      sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    }
    return;
  }

  // Two-tier cancellation. `beginAbort` has already tripped the run's
  // AbortController, which the runtime was handed at spawn time — that is the
  // tier that always applies, including the window this handler used to miss
  // entirely (no provider id yet, so nothing addressable to interrupt).
  //
  // The id-keyed `abortFn` remains the preferred tier when the id *is* known:
  // it is the provider's own graceful interrupt, which unwinds the CLI/SDK
  // cleanly and lets it flush partial output, whereas the signal is a blunter
  // cancel. Its absence is no longer a failure — it just means the signal is
  // doing the work — so a missing provider id must not be reported as a failed
  // abort. Exit code 0 is "we cancelled this run", which is now true in both
  // tiers; only a provider interrupt that was attempted and refused is a
  // genuine failure.
  const abortFn = dependencies.abortFns[run.provider];
  let interruptFailed = false;
  if (abortFn && run.providerSessionId) {
    interruptFailed = !(await abortFn(run.providerSessionId));
  }

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

    // Which run the client's `lastSeq` was recorded against — `seq` restarts
    // per run, so replay only honors the counter when the runs match.
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

    // Pending interactions are tracked under the provider-native id inside
    // each runtime; remap their sessionId so the client only sees app ids.
    const pendingPermissions = (run?.providerSessionId
      ? dependencies.getPendingInteractiveRequestsForSession(run.providerSessionId)
      : []
    ).map((approval) =>
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
 * Handles `chat.ping`: application-level liveness echo for the client-side
 * half-open-connection watchdog.
 *
 * Browsers answer WS protocol pings inside the network stack — page JS never
 * sees them — so client-side dead-connection detection needs an echo that
 * travels as a normal data frame. The client sends `chat.ping` periodically;
 * missing the `chat_pong` (or any other frame) within its watchdog window
 * makes it force-close and reconnect. `ts` is echoed back untouched so the
 * client can match responses and estimate round-trip latency.
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

  const result = await dependencies.resolveInteractiveRequest(data.requestId, {
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
