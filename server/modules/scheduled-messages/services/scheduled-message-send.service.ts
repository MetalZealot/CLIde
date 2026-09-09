import { sessionsDb, type ScheduledMessageRow } from '@/modules/database/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import type { DispatchResult } from './scheduled-message-dispatcher.service.js';

export type ScheduledMessageSendDependencies<TRun> = {
  /**
   * Where a scheduled run's output goes.
   *
   * Nobody sent this turn, so no client is subscribed to it and there is no
   * originating socket to answer. The connection therefore has to reach every
   * client that is listening, which is what makes the run visible in a chat
   * that is already open.
   */
  connection: RealtimeClientConnection;
  startRun(input: {
    appSessionId: string;
    provider: string;
    providerSessionId: string | null;
    connection: RealtimeClientConnection;
    userId: string | number | null;
  }): TRun | null;
  /** Owns the run it is handed, including completing it however the turn ends. */
  runTurn(input: {
    row: ScheduledMessageRow;
    run: TRun;
    provider: string;
    projectPath: string | null;
    options: Record<string, unknown>;
  }): Promise<void>;
};

function parseOptions(row: ScheduledMessageRow): Record<string, unknown> {
  if (!row.options) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(row.options);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createScheduledMessageSender<TRun>(
  dependencies: ScheduledMessageSendDependencies<TRun>,
) {
  return async function send(row: ScheduledMessageRow): Promise<DispatchResult> {
    const session = sessionsDb.getSessionById(row.session_id);
    if (!session) {
      return { ok: false, reason: `Session "${row.session_id}" no longer exists.` };
    }

    // A run already in flight owns the session; the message waits for the next
    // opening rather than interrupting, which is the behaviour CLIde chose over
    // upstream's interrupt.
    const run = dependencies.startRun({
      appSessionId: row.session_id,
      provider: session.provider,
      providerSessionId: session.provider_session_id,
      connection: dependencies.connection,
      userId: null,
    });
    if (!run) {
      return { ok: false, reason: 'A run is already in progress for this session.' };
    }

    await dependencies.runTurn({
      row,
      run,
      provider: session.provider,
      projectPath: session.project_path,
      options: parseOptions(row),
    });

    return { ok: true };
  };
}
