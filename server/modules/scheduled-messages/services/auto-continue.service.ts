/**
 * The standing per-session Auto-Continue mode: a session set to continue picks
 * itself up after every usage limit, without anyone tapping the offer.
 *
 * It reuses the scheduled-message path whole — a `usage-reset` row, the reset
 * monitor, the same sender — so nothing here waits, retries, or times out.
 */

import { scheduledMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { readAutoContinueMessage } from './auto-continue-message.service.js';
import { cancelScheduledMessage, createScheduledMessage } from './scheduled-message-runtime.service.js';

/**
 * How many limit stops in a row the mode may answer while the user says
 * nothing. An agent that keeps hitting the limit would otherwise re-arm
 * forever; the count clears the moment anything is sent to the session.
 */
export const AUTO_CONTINUE_MAX_CONSECUTIVE = 3;

/** What a continue repeats from the turn that stopped; never its text, files, or rewind target. */
const CONTINUE_SETTING_KEYS = [
  'model', 'effort', 'fastMode', 'permissionMode', 'collaborationMode', 'toolsSettings', 'skipPermissions',
] as const;

/**
 * Each session's last limit-stopped turn settings, for a continue the user
 * arms by hand later. In memory only: after a restart that continue goes
 * without them and the provider's own default mode applies.
 */
const lastStopSettings = new Map<string, Record<string, unknown>>();

function pickContinueSettings(turnOptions: unknown): Record<string, unknown> | undefined {
  if (!turnOptions || typeof turnOptions !== 'object') return undefined;
  const source = turnOptions as Record<string, unknown>;
  const picked = Object.fromEntries(
    CONTINUE_SETTING_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export type AutoContinueOutcome =
  /** Not this session's mode, or the session is gone. */
  | 'off'
  /** Something is already waiting on this reset, offer-scheduled or standing. */
  | 'already-waiting'
  /** The cap was reached, so the mode turned itself off. */
  | 'capped'
  | 'armed';

/**
 * Arms the next continue for a session that stopped on a usage limit.
 *
 * Called at the end of a run the gateway classified as a limit stop, so it
 * never reads a notice's wording.
 */
export function armAutoContinueAfterLimitStop(sessionId: string, turnOptions?: unknown): AutoContinueOutcome {
  const settings = pickContinueSettings(turnOptions);
  if (settings) lastStopSettings.set(sessionId, settings);

  const mode = sessionsDb.getSessionAutoContinue(sessionId);
  if (!mode?.enabled) return 'off';

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) return 'off';

  const waiting = scheduledMessagesDb.listBySession(sessionId)
    .some((row) => row.trigger_kind === 'usage-reset' && (row.state === 'pending' || row.state === 'paused'));
  if (waiting) return 'already-waiting';

  if (mode.streak >= AUTO_CONTINUE_MAX_CONSECUTIVE) {
    // Turning the mode off also clears the count, so switching it back on
    // starts from zero. The limit notice keeps its one-tap offer either way.
    sessionsDb.setSessionAutoContinue(sessionId, false);
    return 'capped';
  }

  createScheduledMessage({
    sessionId,
    provider: session.provider as LLMProvider,
    content: readAutoContinueMessage(),
    options: lastStopSettings.get(sessionId),
    trigger: 'usage-reset',
    scheduledFor: null,
  });
  sessionsDb.countAutoContinueFiring(sessionId);
  return 'armed';
}

/**
 * Sets a session's standing mode from a user action. On, with a limit stop
 * still live, queues the continue now rather than at the next stop; off
 * cancels a waiting continue but never a message the user wrote themselves.
 * Neither counts toward the cap — the user is present.
 */
export function setSessionAutoContinueMode(
  sessionId: string,
  enabled: boolean,
  limitStopLive: boolean,
): boolean | null {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) return null;
  sessionsDb.setSessionAutoContinue(sessionId, enabled);

  const waiting = scheduledMessagesDb.listBySession(sessionId)
    .filter((row) => row.trigger_kind === 'usage-reset' && (row.state === 'pending' || row.state === 'paused'));

  if (enabled && limitStopLive && waiting.length === 0) {
    createScheduledMessage({
      sessionId,
      provider: session.provider as LLMProvider,
      content: readAutoContinueMessage(),
      options: lastStopSettings.get(sessionId),
      trigger: 'usage-reset',
      scheduledFor: null,
    });
  } else if (!enabled) {
    // Identified by its text: the row carries no origin of its own.
    const continueText = readAutoContinueMessage();
    for (const row of waiting) {
      if (row.state === 'pending' && row.content === continueText) cancelScheduledMessage(row.id);
    }
  }
  return enabled;
}
