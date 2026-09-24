import crypto from 'crypto';

import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';
import type {
  LLMProvider,
  SideQuestionAnswer,
  SideQuestionEntry,
  SideQuestionExchange,
  SideQuestionRequest,
} from '@/shared/types.js';

/** Most recent entries kept per session; older ones drop off the front. */
const MAX_ENTRIES_PER_SESSION = 50;

type SessionHistory = {
  entries: SideQuestionEntry[];
  inFlight: Map<string, AbortController>;
};

type SideQuestionsDependencies = {
  ask(
    provider: LLMProvider,
    sessionId: string,
    request: SideQuestionRequest,
  ): Promise<SideQuestionAnswer | null>;
  fork(
    sessionId: string,
    options: { title: string; appendExchange: SideQuestionExchange },
  ): Promise<SideQuestionFork>;
  now(): Date;
  createId(): string;
};

type SideQuestionFork = Awaited<ReturnType<typeof sessionsService.forkSessionById>>;

/** Claude Code's `btw: <question>` fork name, cut at the same 80 characters. */
const forkTitle = (question: string): string => {
  const title = `btw: ${question.replace(/\s+/g, ' ').trim()}`;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
};

const defaultDependencies: SideQuestionsDependencies = {
  ask: (provider, sessionId, request) => providerRuntimeService.askSideQuestion(provider, sessionId, request),
  fork: (sessionId, options) => sessionsService.forkSessionById(sessionId, options),
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
};

/**
 * Side-question history per app session, in memory only: it survives the sheet
 * closing, a refresh, and a device switch, and clears when the server restarts.
 * Nothing here reaches a transcript or the database.
 */
export function createSideQuestionsService(overrides: Partial<SideQuestionsDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const sessions = new Map<string, SessionHistory>();

  const historyFor = (sessionId: string): SessionHistory => {
    let history = sessions.get(sessionId);
    if (!history) {
      history = { entries: [], inFlight: new Map() };
      sessions.set(sessionId, history);
    }
    return history;
  };

  const settle = (sessionId: string, id: string, patch: Partial<SideQuestionEntry>): SideQuestionEntry | null => {
    const entry = sessions.get(sessionId)?.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      // Cleared while in flight: the answer has nowhere to land.
      return null;
    }
    Object.assign(entry, patch);
    return entry;
  };

  return {
    list(sessionId: string): SideQuestionEntry[] {
      return (sessions.get(sessionId)?.entries ?? []).map((entry) => ({ ...entry }));
    },

    /**
     * Asks and resolves with the settled entry. The asker leaving does not
     * cancel: the answer still lands in the history for the next reader.
     * Resolves `null` when this provider has no side-question mechanism.
     */
    async ask(
      provider: LLMProvider,
      sessionId: string,
      question: string,
      cwd: string | null,
    ): Promise<SideQuestionEntry | null> {
      const history = historyFor(sessionId);
      const earlier: SideQuestionExchange[] = history.entries
        .filter((entry) => entry.status === 'answered' && entry.answer)
        .map((entry) => ({
          question: entry.question,
          response: entry.answer as string,
          ...(entry.fallbackNotice ? { fallbackNotice: entry.fallbackNotice } : {}),
        }));

      const entry: SideQuestionEntry = {
        id: dependencies.createId(),
        question,
        status: 'pending',
        askedAt: dependencies.now().toISOString(),
      };
      history.entries.push(entry);
      if (history.entries.length > MAX_ENTRIES_PER_SESSION) {
        history.entries.splice(0, history.entries.length - MAX_ENTRIES_PER_SESSION);
      }

      const controller = new AbortController();
      history.inFlight.set(entry.id, controller);

      try {
        const answer = await dependencies.ask(provider, sessionId, {
          question,
          cwd,
          signal: controller.signal,
          history: earlier,
        });
        if (!answer) {
          history.entries = history.entries.filter((candidate) => candidate.id !== entry.id);
          return null;
        }
        return settle(sessionId, entry.id, {
          status: 'answered',
          answer: answer.answer,
          fallbackNotice: answer.fallbackNotice ?? null,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return null;
        }
        return settle(sessionId, entry.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'That side question could not be answered.',
        });
      } finally {
        history.inFlight.delete(entry.id);
      }
    },

    /**
     * Starts a new session from the main conversation with this exchange
     * appended as its last turn, the way Claude Code's `f` does.
     */
    async fork(sessionId: string, entryId: string): Promise<SideQuestionFork> {
      const entry = sessions.get(sessionId)?.entries.find((candidate) => candidate.id === entryId);
      if (!entry || entry.status !== 'answered' || !entry.answer) {
        throw new AppError('Only an answered side question can be forked.', {
          code: 'SIDE_QUESTION_NOT_ANSWERED',
          statusCode: 409,
        });
      }
      return dependencies.fork(sessionId, {
        title: forkTitle(entry.question),
        appendExchange: { question: entry.question, response: entry.answer },
      });
    },

    /** Empties the session's history and cancels anything still being asked. */
    clear(sessionId: string): void {
      const history = sessions.get(sessionId);
      if (!history) {
        return;
      }
      for (const controller of history.inFlight.values()) {
        controller.abort();
      }
      sessions.delete(sessionId);
    },
  };
}

export const sideQuestionsService = createSideQuestionsService();
