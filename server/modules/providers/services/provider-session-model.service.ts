import { sessionsDb } from '@/modules/database/index.js';
import type {
  LLMProvider,
  ProviderChangeActiveModelInput,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';

/**
 * Storage seam for per-session model picks.
 *
 * Defaults to the sessions table. Tests inject a fake so model-precedence
 * behaviour can be exercised without standing up a database, which is also why
 * this is an interface rather than a direct `sessionsDb` call at each site.
 */
export type SessionModelPickStore = {
  getSessionModelPick(
    sessionId: string,
    provider: string,
  ): { model: string; updatedAt: string | null } | null;
  setSessionModelPick(
    sessionId: string,
    provider: string,
    model: string,
    updatedAt: string,
  ): boolean;
};

export type SessionModelPickOptions = {
  store?: SessionModelPickStore;
  supported?: boolean;
};

const defaultStore: SessionModelPickStore = {
  getSessionModelPick: (sessionId, provider) => sessionsDb.getSessionModelPick(sessionId, provider),
  setSessionModelPick: (sessionId, provider, model, updatedAt) =>
    sessionsDb.setSessionModelPick(sessionId, provider, model, updatedAt),
};

const buildUnsupported = (
  provider: LLMProvider,
  sessionId: string,
): ProviderSessionActiveModelChange => ({
  provider,
  sessionId,
  supported: false,
  changed: false,
  model: null,
});

const buildUnchanged = (
  provider: LLMProvider,
  sessionId: string,
): ProviderSessionActiveModelChange => ({
  provider,
  sessionId,
  supported: true,
  changed: false,
  model: null,
});

/**
 * Reads the model the user explicitly picked for one session.
 *
 * Absence is normalized to `{ changed: false }` so callers can treat "no pick"
 * as "use the ordinary model selection flow" without null checks.
 *
 * The returned `updatedAt` is what `pickSupersedesTranscript` compares against
 * the last transcript turn. A pick that somehow lost its timestamp is reported
 * without one, and that rule then defers to the transcript — the safe direction,
 * since the transcript is evidence of what actually ran (ADR 0003).
 */
export async function readProviderSessionModelPick(
  provider: LLMProvider,
  sessionId: string,
  options: SessionModelPickOptions = {},
): Promise<ProviderSessionActiveModelChange> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return buildUnsupported(provider, normalizedSessionId);
  }

  if (options.supported === false) {
    return buildUnsupported(provider, normalizedSessionId);
  }

  const store = options.store ?? defaultStore;
  const pick = store.getSessionModelPick(normalizedSessionId, provider);
  if (!pick?.model?.trim()) {
    return buildUnchanged(provider, normalizedSessionId);
  }

  return {
    provider,
    sessionId: normalizedSessionId,
    supported: true,
    changed: true,
    model: pick.model.trim(),
    ...(pick.updatedAt ? { updatedAt: pick.updatedAt } : {}),
  };
}

/**
 * Persists the model the user picked for one session.
 *
 * Writes only to a row that matches both the session id and the provider. A
 * session that has no row yet (a brand-new chat whose row is created on first
 * send) reports `changed: false` rather than inventing one: the provider-level
 * default already seeds new sessions, so there is nothing to record until the
 * session exists.
 */
export async function writeProviderSessionModelPick(
  provider: LLMProvider,
  input: ProviderChangeActiveModelInput,
  options: SessionModelPickOptions = {},
): Promise<ProviderSessionActiveModelChange> {
  const normalizedSessionId = input.sessionId.trim();
  const normalizedModel = input.model.trim();

  if (options.supported === false) {
    return buildUnsupported(provider, normalizedSessionId);
  }

  if (!normalizedSessionId || !normalizedModel) {
    return buildUnchanged(provider, normalizedSessionId);
  }

  const store = options.store ?? defaultStore;
  const updatedAt = new Date().toISOString();
  const stored = store.setSessionModelPick(
    normalizedSessionId,
    provider,
    normalizedModel,
    updatedAt,
  );

  if (!stored) {
    return buildUnchanged(provider, normalizedSessionId);
  }

  return {
    provider,
    sessionId: normalizedSessionId,
    supported: true,
    changed: true,
    model: normalizedModel,
    updatedAt,
  };
}
