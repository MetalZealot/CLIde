import { sessionsDb, type ScheduledMessageRow } from '@/modules/database/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import type { DispatchResult } from './scheduled-message-dispatcher.service.js';

/**
 * A connection that is never open.
 *
 * A scheduled message fires with no client attached — the phone may be asleep.
 * The run registry only needs `{ readyState, send }`, and the writer checks
 * readyState before every send, so this sink discards outbound frames while
 * the registry still records them. A client that connects later re-attaches
 * through `attachConnection` and receives the recorded events.
 */
const DETACHED_CONNECTION: RealtimeClientConnection = {
  readyState: 3, // CLOSED
  send() {},
};

export type ScheduledMessageSendDependencies = {
  startRun(input: {
    appSessionId: string;
    provider: string;
    providerSessionId: string | null;
    connection: RealtimeClientConnection;
    userId: string | number | null;
  }): unknown;
  runTurn(input: {
    row: ScheduledMessageRow;
    providerSessionId: string | null;
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

export function createScheduledMessageSender(dependencies: ScheduledMessageSendDependencies) {
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
      connection: DETACHED_CONNECTION,
      userId: null,
    });
    if (!run) {
      return { ok: false, reason: 'A run is already in progress for this session.' };
    }

    await dependencies.runTurn({
      row,
      providerSessionId: session.provider_session_id,
      projectPath: session.project_path,
      options: parseOptions(row),
    });

    return { ok: true };
  };
}
