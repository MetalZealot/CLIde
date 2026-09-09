import { userDb } from '@/modules/database/index.js';
import { providerRuntimeService, reconcileProviderUsageResetMonitor } from '@/modules/providers/index.js';
import {
  createScheduledMessageDispatcher,
  createScheduledMessageSender,
  setScheduledMessageRuntime,
} from '@/modules/scheduled-messages/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { buildChatRuntimeOptions } from '@/modules/websocket/services/chat-websocket.service.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { AnyRecord, LLMProvider } from '@/shared/types.js';

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
    startRun: (input) => chatRunRegistry.startRun({
      ...input,
      provider: input.provider as LLMProvider,
    }),
    runTurn: async ({ row, run, provider, options }) => {
      const session = sessionsDb.getSessionById(row.session_id);
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
    },
  });

  // Rebuilds the timers for anything scheduled before this process started.
  dispatcher.reconcile();
}

/** Stops pending timers during shutdown; the rows outlive the process. */
export function closeScheduledMessages(): void {
  activeDispatcher?.close();
  activeDispatcher = null;
  setScheduledMessageRuntime(null);
}
