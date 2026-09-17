import { scheduledMessagesDb, userDb, type ScheduledMessageRow } from '@/modules/database/index.js';
import { providerRuntimeService, reconcileProviderUsageResetMonitor } from '@/modules/providers/index.js';
import {
  AUTO_CONTINUE_MAX_CONSECUTIVE,
  armAutoContinueAfterLimitStop,
  createScheduledMessageDispatcher,
  createScheduledMessageSender,
  readScheduledMessageAttachments,
  setScheduledMessageRuntime,
} from '@/modules/scheduled-messages/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { buildChatRuntimeOptions } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { AnyRecord, LLMProvider, RealtimeClientConnection } from '@/shared/types.js';

/**
 * Every listening client, as one connection.
 *
 * A scheduled turn has no originating socket to answer: nobody pressed send,
 * so nobody is subscribed to the run. Frames carry the app session id and the
 * frontend files them by it, so fanning out is what makes the turn appear in a
 * chat that is already open — and reports open, because the writer drops
 * anything it believes is closed.
 */
const BROADCAST_CONNECTION: RealtimeClientConnection = {
  get readyState() {
    return WS_OPEN_STATE;
  },
  send(data: string) {
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(data);
    });
  },
};

/**
 * Tells open clients that a stored message just became a real one.
 *
 * Without it the reply arrives with nothing above it: the composer never drew
 * this turn, because the client did not send it. The scheduled bubble clears
 * off the same frame.
 */
function announceScheduledSend(row: ScheduledMessageRow): void {
  BROADCAST_CONNECTION.send(JSON.stringify({
    kind: 'scheduled_message_sent',
    scheduledMessageId: row.id,
    sessionId: row.session_id,
    provider: row.provider,
    content: row.content,
    // Without them the bubble cannot match its transcript copy, and both show.
    attachments: readScheduledMessageAttachments(row),
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Tells every client which sessions are still waiting on something, so the
 * sidebar's timer column matches the rows rather than a client's own guess at
 * what it scheduled.
 */
function broadcastPendingSessions(): void {
  BROADCAST_CONNECTION.send(JSON.stringify({
    kind: 'scheduled_messages_changed',
    sessionIds: scheduledMessagesDb.listSessionIdsWithPending(),
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Tells open clients the standing mode gave up on a session.
 *
 * Nothing writes this to the transcript, so it is a live frame only: a client
 * that was closed at the time finds the mode off in the session's menu, and
 * the limit notice still carries its one-tap offer.
 */
function announceAutoContinueCapped(sessionId: string): void {
  BROADCAST_CONNECTION.send(JSON.stringify({
    kind: 'auto_continue_capped',
    sessionId,
    limit: AUTO_CONTINUE_MAX_CONSECUTIVE,
    timestamp: new Date().toISOString(),
  }));
}

type ChatRun = NonNullable<ReturnType<typeof chatRunRegistry.startRun>>;

let activeDispatcher: ReturnType<typeof createScheduledMessageDispatcher> | null = null;

/**
 * Connects stored scheduled messages to the chat runtime.
 *
 * The scheduled-messages module owns rows and timers and nothing that can
 * start a turn; this is where the two meet, because it is the layer that
 * already knows both. A scheduled turn goes through `buildChatRuntimeOptions`
 * exactly as `chat.send` does, so attachments are re-validated and `cwd` comes
 * from the session row rather than from whatever was stored months earlier.
 */
export function initializeScheduledMessages(): void {
  if (activeDispatcher) return;

  const send = createScheduledMessageSender<ChatRun>({
    connection: BROADCAST_CONNECTION,
    startRun: (input) => chatRunRegistry.startRun({
      ...input,
      provider: input.provider as LLMProvider,
      broadcast: true,
    }),
    runTurn: async ({ row, run, provider, options }) => {
      const session = sessionsDb.getSessionById(row.session_id);
      announceScheduledSend(row);
      // The row left 'pending' when the dispatcher claimed it.
      broadcastPendingSessions();
      try {
        const runtimeOptions: AnyRecord = await buildChatRuntimeOptions({
          session: {
            project_path: session?.project_path ?? null,
            jsonl_path: session?.jsonl_path ?? null,
          },
          sessionId: row.session_id,
          provider: provider as LLMProvider,
          clientOptions: options,
          abortController: run.abortController,
        });
        await providerRuntimeService.run(
          provider as LLMProvider,
          row.content,
          runtimeOptions,
          run.writer,
        );
      } finally {
        // Same safety net as `chat.send`: a runtime that returned without its
        // terminal `complete` would leave the session stuck "processing" on
        // every client that attaches later.
        chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
      }
    },
  });

  const dispatcher = createScheduledMessageDispatcher({
    send,
    now: Date.now,
    setTimeout,
    clearTimeout,
  });

  activeDispatcher = dispatcher;
  setScheduledMessageRuntime({
    dispatcher,
    onPendingChanged: () => {
      const user = userDb.getFirstUser();
      if (user) reconcileProviderUsageResetMonitor(user.id);
      broadcastPendingSessions();
    },
    isSessionBusy: (sessionId) => chatRunRegistry.isProcessing(sessionId),
  });

  // A session set to continue itself arms the next one here: the gateway
  // classifies the stop, this layer decides what to do about it.
  chatRunRegistry.onUsageLimitStop((sessionId) => {
    const outcome = armAutoContinueAfterLimitStop(sessionId);
    if (outcome === 'armed') broadcastPendingSessions();
    if (outcome === 'capped') announceAutoContinueCapped(sessionId);
  });

  // Rebuilds the timers for anything scheduled before this process started.
  dispatcher.reconcile();
}

/** Stops pending timers during shutdown; the rows outlive the process. */
export function closeScheduledMessages(): void {
  chatRunRegistry.onUsageLimitStop(null);
  activeDispatcher?.close();
  activeDispatcher = null;
  setScheduledMessageRuntime(null);
}
