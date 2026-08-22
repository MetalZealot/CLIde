import { sessionsDb } from '@/modules/database/index.js';
import { readClaudeSessionEffortFromJsonl } from '@/modules/providers/list/claude/claude-session-effort.js';
import { readCodexSessionEffortFromRollout } from '@/modules/providers/list/codex/codex-session-effort.js';
import { pickSupersedesTranscript } from '@/modules/providers/services/provider-session-model.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type {
  LLMProvider,
  ProviderChangeSessionEffortInput,
  ProviderSessionEffort,
  ProviderSessionEffortEvidence,
  ProviderSessionEffortPick,
} from '@/shared/types.js';

/**
 * Storage seam for per-session effort picks.
 *
 * Defaults to the sessions table, and exists as an interface for the same
 * reason its model counterpart does: precedence behaviour has to be testable
 * without standing up a database.
 */
export type SessionEffortPickStore = {
  getSessionEffortPick(
    sessionId: string,
    provider: string,
  ): { effort: string; updatedAt: string | null } | null;
  setSessionEffortPick(
    sessionId: string,
    provider: string,
    effort: string,
    updatedAt: string,
  ): boolean;
};

type SessionEffortRow = {
  provider_session_id?: string | null;
  jsonl_path?: string | null;
};

export type SessionEffortOptions = {
  store?: SessionEffortPickStore;
  /** Overrides the capability matrix; tests and callers that already know. */
  supported?: boolean;
  getSessionRow?: (sessionId: string) => SessionEffortRow | null;
  /** Injected evidence reader, bypassing the per-provider transcript readers. */
  readEvidence?: (
    provider: LLMProvider,
    sessionId: string,
  ) => Promise<ProviderSessionEffortEvidence | null>;
  /** The effort a turn runs at when nothing is chosen, when the caller knows it. */
  providerDefault?: string | null;
};

/**
 * The stored value meaning "send no effort override". A real choice, distinct
 * from NULL, and the runtimes drop it rather than passing it through.
 */
const NO_OVERRIDE_EFFORT = 'default';

const defaultStore: SessionEffortPickStore = {
  getSessionEffortPick: (sessionId, provider) => sessionsDb.getSessionEffortPick(sessionId, provider),
  setSessionEffortPick: (sessionId, provider, effort, updatedAt) =>
    sessionsDb.setSessionEffortPick(sessionId, provider, effort, updatedAt),
};

const buildUnsupportedPick = (
  provider: LLMProvider,
  sessionId: string,
): ProviderSessionEffortPick => ({
  provider,
  sessionId,
  supported: false,
  changed: false,
  effort: null,
});

const buildUnchangedPick = (
  provider: LLMProvider,
  sessionId: string,
): ProviderSessionEffortPick => ({
  provider,
  sessionId,
  supported: true,
  changed: false,
  effort: null,
});

const isEffortSupported = (provider: LLMProvider, options: SessionEffortOptions): boolean => (
  options.supported ?? providerCapabilitiesService.getProviderCapabilities(provider).supportsEffort
);

/**
 * Reads the effort the user explicitly picked for one session.
 *
 * Absence normalizes to `{ changed: false }` so callers can treat "nothing
 * picked" as "use the provider's default" without null checks. A pick that lost
 * its timestamp is reported without one, and then loses to any turn evidence —
 * the safe direction, since evidence is a record of what actually ran.
 */
export async function readProviderSessionEffortPick(
  provider: LLMProvider,
  sessionId: string,
  options: SessionEffortOptions = {},
): Promise<ProviderSessionEffortPick> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || !isEffortSupported(provider, options)) {
    return buildUnsupportedPick(provider, normalizedSessionId);
  }

  const store = options.store ?? defaultStore;
  const pick = store.getSessionEffortPick(normalizedSessionId, provider);
  const effort = pick?.effort?.trim();
  if (!effort) {
    return buildUnchangedPick(provider, normalizedSessionId);
  }

  return {
    provider,
    sessionId: normalizedSessionId,
    supported: true,
    changed: true,
    effort,
    ...(pick?.updatedAt ? { updatedAt: pick.updatedAt } : {}),
  };
}

/**
 * Persists the effort the user picked for one session.
 *
 * Writes only to a row matching both the session id and the provider. A session
 * with no row yet (a brand-new chat, whose row appears on first send) reports
 * `changed: false` rather than inventing one — the client's provider-level seed
 * already covers a fresh chat until its row exists.
 *
 * The literal `default` is stored, not skipped: choosing it is a deliberate
 * "run this session with no effort override", which has to survive a reload the
 * same way choosing `high` does.
 */
export async function writeProviderSessionEffortPick(
  provider: LLMProvider,
  input: ProviderChangeSessionEffortInput,
  options: SessionEffortOptions = {},
): Promise<ProviderSessionEffortPick> {
  const normalizedSessionId = input.sessionId.trim();
  const normalizedEffort = input.effort.trim();

  if (!isEffortSupported(provider, options)) {
    return buildUnsupportedPick(provider, normalizedSessionId);
  }

  if (!normalizedSessionId || !normalizedEffort) {
    return buildUnchangedPick(provider, normalizedSessionId);
  }

  const store = options.store ?? defaultStore;
  const updatedAt = new Date().toISOString();
  const stored = store.setSessionEffortPick(
    normalizedSessionId,
    provider,
    normalizedEffort,
    updatedAt,
  );

  if (!stored) {
    return buildUnchangedPick(provider, normalizedSessionId);
  }

  return {
    provider,
    sessionId: normalizedSessionId,
    supported: true,
    changed: true,
    effort: normalizedEffort,
    updatedAt,
  };
}

/**
 * Weighs a stored request against provider turn evidence.
 *
 * The rule is ADR 0003's, unchanged and deliberately shared with the model
 * path via `pickSupersedesTranscript`: a request applies to the *next* turn, so
 * it describes the session only while it is at least as recent as the last turn
 * the provider recorded. A newer turn means the effort changed by a path the
 * app never saw, and that turn is what ran.
 *
 * Pure, and separate from the readers, so precedence can be exercised without a
 * database or a transcript on disk.
 */
export function resolveSessionEffort(params: {
  provider: LLMProvider;
  sessionId: string;
  supported: boolean;
  pick: { effort: string | null; updatedAt?: string } | null;
  evidence: ProviderSessionEffortEvidence | null;
  providerDefault?: string | null;
}): ProviderSessionEffort {
  const {
    provider, sessionId, supported, pick, evidence,
  } = params;

  if (!supported) {
    return {
      provider,
      sessionId,
      supported: false,
      requested: null,
      effective: null,
      effort: null,
      source: 'none',
    };
  }

  const requested = pick?.effort?.trim() || null;
  const effective = evidence?.effort?.trim() || null;
  const providerDefault = params.providerDefault?.trim() || null;

  const base = {
    provider,
    sessionId,
    supported: true,
    requested,
    ...(pick?.updatedAt ? { requestedAt: pick.updatedAt } : {}),
    effective,
    ...(evidence?.timestamp ? { effectiveAt: evidence.timestamp } : {}),
  };

  // `default` is a standing instruction — let the provider choose each turn — so
  // every turn it produces reports a concrete effort that disagrees with it.
  // Ageing it out against that evidence would retire the choice after one turn,
  // so only a newer pick replaces it.
  const isStandingDefault = requested === NO_OVERRIDE_EFFORT;
  if (requested
    && (isStandingDefault || pickSupersedesTranscript(pick?.updatedAt, evidence?.timestamp))) {
    return { ...base, effort: requested, source: 'pick' };
  }

  if (effective) {
    return { ...base, effort: effective, source: 'transcript' };
  }

  return {
    ...base,
    effort: providerDefault,
    source: providerDefault ? 'default' : 'none',
  };
}

/**
 * Turn evidence readers, by provider.
 *
 * Only providers that record what a turn actually ran at appear here. An
 * adapter missing from this map reports no effective effort at all rather than
 * echoing the stored request back as confirmation — an invented "effective"
 * value would beat nothing and mislead everything.
 */
const EVIDENCE_READERS: Partial<Record<
  LLMProvider,
  (transcriptSessionId: string, transcriptPath: string) => Promise<ProviderSessionEffortEvidence | null>
>> = {
  claude: readClaudeSessionEffortFromJsonl,
  codex: (_transcriptSessionId, transcriptPath) => readCodexSessionEffortFromRollout(transcriptPath),
};

async function readEffortEvidence(
  provider: LLMProvider,
  sessionId: string,
  options: SessionEffortOptions,
): Promise<ProviderSessionEffortEvidence | null> {
  if (options.readEvidence) {
    return options.readEvidence(provider, sessionId);
  }

  const reader = EVIDENCE_READERS[provider];
  if (!reader) {
    return null;
  }

  try {
    const row = options.getSessionRow
      ? options.getSessionRow(sessionId)
      : sessionsDb.getSessionById(sessionId);
    const transcriptPath = row?.jsonl_path;
    if (!transcriptPath) {
      return null;
    }

    // Transcript entries carry the provider-native session id, not the
    // app-level id the frontend sends with commands.
    return await reader(row?.provider_session_id || sessionId, transcriptPath);
  } catch {
    return null;
  }
}

/**
 * The one entry point callers should use: what effort is this session on?
 *
 * Combines the stored request with whatever the provider recorded and applies
 * the precedence rule. Providers without effort support resolve to
 * `supported: false` through the capability matrix, so a caller never has to
 * special-case Cursor.
 */
export async function getProviderSessionEffort(
  provider: LLMProvider,
  sessionId: string,
  options: SessionEffortOptions = {},
): Promise<ProviderSessionEffort> {
  const normalizedSessionId = sessionId.trim();
  const supported = Boolean(normalizedSessionId) && isEffortSupported(provider, options);

  if (!supported) {
    return resolveSessionEffort({
      provider,
      sessionId: normalizedSessionId,
      supported: false,
      pick: null,
      evidence: null,
    });
  }

  const pick = await readProviderSessionEffortPick(provider, normalizedSessionId, options);
  const evidence = await readEffortEvidence(provider, normalizedSessionId, options);

  return resolveSessionEffort({
    provider,
    sessionId: normalizedSessionId,
    supported: true,
    pick: pick.changed ? { effort: pick.effort, updatedAt: pick.updatedAt } : null,
    evidence,
    providerDefault: options.providerDefault ?? null,
  });
}
