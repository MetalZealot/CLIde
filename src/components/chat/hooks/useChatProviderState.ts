import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { CollaborationMode, PendingPermissionRequest, PermissionMode } from '../types/types';
import type {
  ProjectSession,
  LLMProvider,
  Project,
  ProviderModelOption,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';
import {
  DEFAULT_EFFORT_VALUE,
  FALLBACK_PROVIDER_EFFORT_VALUES,
  toProviderEffortOptions,
} from '../constants/providerEffort';
import { useProviderCapabilities } from '../../../hooks/useProviderCapabilities';
import { getNextRoutinePermissionMode } from '../utils/chatPermissions';
import { readProviderDefaultModel } from '../../../utils/providerDefaultModel';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  // Must be a real alias. "default" was not one: Claude Code silently ran its
  // built-in Sonnet instead of the settings-cascade model.
  claude: 'sonnet',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  opencode: 'anthropic/claude-sonnet-4-5',
};

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

/**
 * Holds an effort to what the chosen model actually offers. An explicit
 * `default` is a standing choice and stays one; anything the model does not
 * offer falls back to `default` rather than being sent as-is.
 */
export const reconcileEffortForAllowedValues = (
  currentEffort: string,
  allowedValues: string[],
): string => {
  if (allowedValues.length === 0) return DEFAULT_EFFORT_VALUE;
  if (!currentEffort || currentEffort === DEFAULT_EFFORT_VALUE) return DEFAULT_EFFORT_VALUE;
  return allowedValues.includes(currentEffort) ? currentEffort : DEFAULT_EFFORT_VALUE;
};

const readStoredProvider = (): LLMProvider => {
  const storedProvider = localStorage.getItem('selected-provider');
  return PROVIDERS.includes(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'claude';
};

/**
 * Fallback permission-mode matrix used only until the backend capability
 * matrix (`GET /api/providers/capabilities`) has loaded. The backend is the
 * source of truth; this mirror exists so the composer renders sensibly on
 * first paint and when the capabilities request fails.
 */
const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  claude: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
  cursor: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  codex: ['default', 'acceptEdits', 'bypassPermissions'],
  opencode: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
};

// Collaboration controls stay hidden until the backend confirms the active
// runtime can honor them. Codex's SDK fallback has no Plan surface even though
// App Server does.
const FALLBACK_COLLABORATION_MODES: Record<LLMProvider, CollaborationMode[]> = {
  claude: [],
  cursor: [],
  codex: [],
  opencode: [],
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
  /**
   * The open session's own model and effort, owned by `SessionStore`. Null
   * while unresolved or when the session has nothing of its own, which is what
   * makes the provider-level values below seeds rather than state: they apply
   * only until the session answers for itself.
   */
  sessionModel: string | null;
  sessionEffort: string | null;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
    cache?: ProviderModelsCacheInfo;
  };
};

type SessionModelApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string | null;
    model?: string | null;
    /**
     * `session` and `provider` are real answers for this session; `default`
     * means the backend had nothing recorded and returned the catalog default,
     * which the composer replaces with the user's per-provider selection.
     */
    source?: 'session' | 'provider' | 'default';
  };
};

type SessionEffortApiResponse = {
  success?: boolean;
  data?: {
    supported?: boolean;
    effort?: string | null;
    source?: 'pick' | 'transcript' | 'default' | 'none';
  };
};

export function useChatProviderState({
  selectedSession,
  selectedProject: _selectedProject,
  sessionModel,
  sessionEffort,
}: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>('build');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(readStoredProvider);
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || FALLBACK_DEFAULT_MODEL.cursor;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || FALLBACK_DEFAULT_MODEL.claude;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || FALLBACK_DEFAULT_MODEL.codex;
  });
  const [providerEfforts, setProviderEfforts] = useState<Partial<Record<LLMProvider, string>>>(() => {
    return PROVIDERS.reduce<Partial<Record<LLMProvider, string>>>((acc, targetProvider) => {
      acc[targetProvider] = localStorage.getItem(`${targetProvider}-effort`) || DEFAULT_EFFORT_VALUE;
      return acc;
    }, {});
  });
  const [opencodeModel, setOpenCodeModel] = useState<string>(() => {
    return localStorage.getItem('opencode-model') || FALLBACK_DEFAULT_MODEL.opencode;
  });

  /**
   * Backend-owned capability matrix keyed by provider. Drives the permission
   * mode picker (and is the extension point for future per-provider UI
   * differences) so the frontend stays free of hardcoded provider branching.
   * Null until `/api/providers/capabilities` resolves; the static fallback
   * map covers that window.
   */
  const providerCapabilities = useProviderCapabilities();

  const [providerModelCatalog, setProviderModelCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsDefinition>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);

  const providerModelsRequestIdRef = useRef(0);

  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    if (targetProvider === 'claude') {
      setClaudeModel(model);
      localStorage.setItem('claude-model', model);
      return;
    }

    if (targetProvider === 'cursor') {
      setCursorModel(model);
      localStorage.setItem('cursor-model', model);
      return;
    }

    if (targetProvider === 'codex') {
      setCodexModel(model);
      localStorage.setItem('codex-model', model);
      return;
    }

    setOpenCodeModel(model);
    localStorage.setItem('opencode-model', model);
  }, []);

  /**
   * Switches the provider a *new* chat starts with. Persisted immediately: the
   * session-creation path and the realtime normalizer both read
   * `selected-provider` from storage rather than this state.
   */
  const selectProvider = useCallback((nextProvider: LLMProvider) => {
    setProvider(nextProvider);
    localStorage.setItem('selected-provider', nextProvider);
  }, []);

  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    setProviderEfforts((previous) => (
      previous[targetProvider] === effort
        ? previous
        : { ...previous, [targetProvider]: effort }
    ));
    localStorage.setItem(`${targetProvider}-effort`, effort);
  }, []);

  // Single load per mount, and deliberately no client-side hard refresh: Claude
  // and Codex are never cached server-side, and the two cached providers refresh
  // on the next page load.
  const loadProviderModels = useCallback(async () => {
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    setProviderModelsLoading(true);

    try {
      const results = await Promise.all(
        PROVIDERS.map(async (p) => {
          const response = await authenticatedFetch(`/api/providers/${p}/models`);
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!body.success || !body.data?.models || !body.data?.cache) {
            return null;
          }

          return body.data;
        }),
      );

      if (providerModelsRequestIdRef.current !== requestId) {
        return;
      }

      const nextCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {};
      PROVIDERS.forEach((p, i) => {
        const entry = results[i];
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry.models;
      });

      setProviderModelCatalog(nextCatalog);
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  const getPermissionModesForProvider = useCallback((targetProvider: LLMProvider): PermissionMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.permissionModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return capabilityModes as PermissionMode[];
    }
    return FALLBACK_PERMISSION_MODES[targetProvider] ?? ['default'];
  }, [providerCapabilities]);

  const getDefaultPermissionModeForProvider = useCallback((targetProvider: LLMProvider): PermissionMode => {
    const modes = getPermissionModesForProvider(targetProvider);
    const capabilityDefault = providerCapabilities?.[targetProvider]?.defaultPermissionMode as PermissionMode | undefined;
    if (capabilityDefault && modes.includes(capabilityDefault)) {
      return capabilityDefault;
    }
    return modes[0] ?? 'default';
  }, [getPermissionModesForProvider, providerCapabilities]);

  const getCollaborationModesForProvider = useCallback((targetProvider: LLMProvider): CollaborationMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.collaborationModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return capabilityModes as CollaborationMode[];
    }
    return FALLBACK_COLLABORATION_MODES[targetProvider] ?? [];
  }, [providerCapabilities]);

  const getDefaultCollaborationModeForProvider = useCallback((targetProvider: LLMProvider): CollaborationMode => {
    const modes = getCollaborationModesForProvider(targetProvider);
    const capabilityDefault = providerCapabilities?.[targetProvider]?.defaultCollaborationMode as CollaborationMode | undefined;
    if (capabilityDefault && modes.includes(capabilityDefault)) {
      return capabilityDefault;
    }
    return modes[0] ?? 'build';
  }, [getCollaborationModesForProvider, providerCapabilities]);

  const getSupportsEffortForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    const capabilitySupport = providerCapabilities?.[targetProvider]?.supportsEffort;
    if (typeof capabilitySupport === 'boolean') {
      return capabilitySupport;
    }
    return Boolean(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider]?.length);
  }, [providerCapabilities]);

  const getSupportsRewindForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    // No static fallback: rewind UI stays hidden until the backend confirms the
    // capability, so a failed fetch cannot surface an affordance the runtime
    // would reject.
    return providerCapabilities?.[targetProvider]?.supportsRewind === true;
  }, [providerCapabilities]);

  const getSupportsForkForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    // Like rewind, this stays hidden until the backend confirms the active
    // runtime can honor it.
    return providerCapabilities?.[targetProvider]?.supportsFork === true;
  }, [providerCapabilities]);

  const pickStoredOrCurrent = (
    storageKey: string,
    current: string,
    def: ProviderModelsDefinition,
    configuredDefault = '',
  ): string => {
    const stored = localStorage.getItem(storageKey);
    if (stored && def.OPTIONS.some((o) => o.value === stored)) {
      return stored;
    }
    if (current && def.OPTIONS.some((o) => o.value === current)) {
      return current;
    }
    // A default set in Settings outranks the catalog's own, which is only the
    // provider's suggestion.
    if (configuredDefault && def.OPTIONS.some((o) => o.value === configuredDefault)) {
      return configuredDefault;
    }
    return def.DEFAULT;
  };

  const getModelOption = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): ProviderModelOption | null => {
    const definition = providerModelCatalog[targetProvider];
    if (!definition) {
      return null;
    }

    return definition.OPTIONS.find((option) => option.value === model) ?? null;
  }, [providerModelCatalog]);

  const getEffortOptionsForModel = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): NonNullable<ProviderModelOption['effort']>['values'] => {
    if (!getSupportsEffortForProvider(targetProvider)) {
      return [];
    }

    // `supportsEffort` is the real gate; a catalog entry's `effort.values` only
    // refines the list. Some models (Claude's `haiku`) are in the catalog but
    // declare no effort values — fall back to the provider's, as when the model
    // is absent entirely, so the Effort picker stays visible.
    const option = getModelOption(targetProvider, model);
    const optionValues = option?.effort?.values;
    if (optionValues && optionValues.length > 0) {
      return optionValues;
    }

    return toProviderEffortOptions(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider] ?? []);
  }, [getModelOption, getSupportsEffortForProvider]);

  const getAllowedEffortValues = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): string[] => (
    getEffortOptionsForModel(targetProvider, model).map((value) => value.value)
  ), [getEffortOptionsForModel]);

  const reconcileStoredEffort = useCallback((
    targetProvider: LLMProvider,
    model: string,
    currentEffort: string,
  ): string => reconcileEffortForAllowedValues(
    currentEffort,
    getAllowedEffortValues(targetProvider, model),
  ), [getAllowedEffortValues]);

  const providerModels = useMemo<Record<LLMProvider, string>>(() => ({
    claude: claudeModel,
    cursor: cursorModel,
    codex: codexModel,
    opencode: opencodeModel,
  }), [claudeModel, cursorModel, codexModel, opencodeModel]);

  useEffect(() => {
    const claude = providerModelCatalog.claude;
    if (claude) {
      const next = pickStoredOrCurrent('claude-model', claudeModel, claude, readProviderDefaultModel('claude'));
      if (next !== claudeModel) {
        setClaudeModel(next);
      }
      if (localStorage.getItem('claude-model') !== next) {
        localStorage.setItem('claude-model', next);
      }
    }
  }, [providerModelCatalog.claude, claudeModel]);

  useEffect(() => {
    const cursor = providerModelCatalog.cursor;
    if (cursor) {
      const next = pickStoredOrCurrent('cursor-model', cursorModel, cursor, readProviderDefaultModel('cursor'));
      if (next !== cursorModel) {
        setCursorModel(next);
      }
      if (localStorage.getItem('cursor-model') !== next) {
        localStorage.setItem('cursor-model', next);
      }
    }
  }, [providerModelCatalog.cursor, cursorModel]);

  useEffect(() => {
    const codex = providerModelCatalog.codex;
    if (codex) {
      const next = pickStoredOrCurrent('codex-model', codexModel, codex, readProviderDefaultModel('codex'));
      if (next !== codexModel) {
        setCodexModel(next);
      }
      if (localStorage.getItem('codex-model') !== next) {
        localStorage.setItem('codex-model', next);
      }
    }
  }, [providerModelCatalog.codex, codexModel]);

  useEffect(() => {
    const opencode = providerModelCatalog.opencode;
    if (opencode) {
      const next = pickStoredOrCurrent('opencode-model', opencodeModel, opencode, readProviderDefaultModel('opencode'));
      if (next !== opencodeModel) {
        setOpenCodeModel(next);
      }
      if (localStorage.getItem('opencode-model') !== next) {
        localStorage.setItem('opencode-model', next);
      }
    }
  }, [providerModelCatalog.opencode, opencodeModel]);

  useEffect(() => {
    const nextEfforts: Partial<Record<LLMProvider, string>> = {};
    let hasUpdates = false;

    for (const targetProvider of PROVIDERS) {
      const currentEffort = providerEfforts[targetProvider] ?? DEFAULT_EFFORT_VALUE;
      const nextEffort = reconcileStoredEffort(targetProvider, providerModels[targetProvider], currentEffort);
      if (nextEffort === currentEffort) {
        continue;
      }

      nextEfforts[targetProvider] = nextEffort;
      localStorage.setItem(`${targetProvider}-effort`, nextEffort);
      hasUpdates = true;
    }

    if (hasUpdates) {
      setProviderEfforts((previous) => ({ ...previous, ...nextEfforts }));
    }
  }, [providerEfforts, providerModels, reconcileStoredEffort]);

  useEffect(() => {
    const validModes = getPermissionModesForProvider(provider);
    const sessionSavedMode = selectedSession?.id
      ? (localStorage.getItem(`permissionMode-${selectedSession.id}`) as PermissionMode | null)
      : null;
    // Fall back to the last mode picked for this provider: a brand-new chat
    // only receives its session id after the first send, so without this the
    // mode chosen beforehand would snap back to the default as soon as the
    // session id appears.
    const providerSavedMode = localStorage.getItem(`permissionMode-last-${provider}`) as PermissionMode | null;
    const savedMode = [sessionSavedMode, providerSavedMode].find(
      (mode): mode is PermissionMode => Boolean(mode && validModes.includes(mode)),
    );
    setPermissionMode(savedMode ?? getDefaultPermissionModeForProvider(provider));
  }, [selectedSession?.id, provider, getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  useEffect(() => {
    const validModes = getCollaborationModesForProvider(provider);
    if (validModes.length === 0) {
      setCollaborationMode('build');
      return;
    }

    const sessionId = selectedSession?.id;
    const sessionSavedMode = sessionId
      ? (localStorage.getItem(`collaborationMode-${sessionId}`) as CollaborationMode | null)
      : null;
    const providerSavedMode = localStorage.getItem(`collaborationMode-last-${provider}`) as CollaborationMode | null;
    const savedMode = [sessionSavedMode, providerSavedMode].find(
      (mode): mode is CollaborationMode => Boolean(mode && validModes.includes(mode)),
    );

    // Before collaboration became independent, Codex stored Plan in the
    // permission slot. Preserve that intent once, then repair the access slot to
    // its non-escalating baseline so the two can evolve separately.
    const legacySessionPermission = sessionId
      ? localStorage.getItem(`permissionMode-${sessionId}`)
      : null;
    const legacyProviderPermission = localStorage.getItem(`permissionMode-last-${provider}`);
    const migratedPlan = provider === 'codex'
      && validModes.includes('plan')
      && (legacySessionPermission === 'plan' || legacyProviderPermission === 'plan');
    const nextMode = savedMode
      ?? (migratedPlan ? 'plan' : getDefaultCollaborationModeForProvider(provider));

    setCollaborationMode(nextMode);
    if (migratedPlan) {
      localStorage.setItem(`collaborationMode-last-${provider}`, nextMode);
      localStorage.setItem(`permissionMode-last-${provider}`, 'default');
      if (sessionId) {
        localStorage.setItem(`collaborationMode-${sessionId}`, nextMode);
        localStorage.setItem(`permissionMode-${sessionId}`, 'default');
      }
      setPermissionMode('default');
    }
  }, [
    getCollaborationModesForProvider,
    getDefaultCollaborationModeForProvider,
    provider,
    selectedSession?.id,
  ]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  // Permission prompts belong to a session, not to the transient provider
  // selection that is synchronized after navigation.
  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    setPermissionMode(nextMode);

    // Persist per provider as well as per session: a brand-new chat has no
    // session id yet, and the per-provider key keeps the choice sticky when
    // the real id arrives (and for future sessions of this provider).
    localStorage.setItem(`permissionMode-last-${provider}`, nextMode);
    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [provider, selectedSession?.id]);

  const selectCollaborationMode = useCallback((nextMode: CollaborationMode) => {
    const validModes = getCollaborationModesForProvider(provider);
    if (!validModes.includes(nextMode)) return;

    setCollaborationMode(nextMode);
    localStorage.setItem(`collaborationMode-last-${provider}`, nextMode);
    if (selectedSession?.id) {
      localStorage.setItem(`collaborationMode-${selectedSession.id}`, nextMode);
    }
  }, [getCollaborationModesForProvider, provider, selectedSession?.id]);

  const togglePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);
    const nextMode = getNextRoutinePermissionMode(permissionMode, modes);
    selectPermissionMode(nextMode as PermissionMode);
  }, [permissionMode, provider, getPermissionModesForProvider, selectPermissionMode]);

  const availablePermissionModes = useMemo(
    () => getPermissionModesForProvider(provider),
    [getPermissionModesForProvider, provider],
  );
  const availableCollaborationModes = useMemo(
    () => getCollaborationModesForProvider(provider),
    [getCollaborationModesForProvider, provider],
  );
  const currentCollaborationMode = availableCollaborationModes.length > 0
    ? collaborationMode
    : null;

  const resolvePermissionModeForProvider = useCallback((
    targetProvider: LLMProvider,
    requestedMode: PermissionMode | string,
  ): PermissionMode => {
    const validModes = getPermissionModesForProvider(targetProvider);
    return validModes.includes(requestedMode as PermissionMode)
      ? requestedMode as PermissionMode
      : getDefaultPermissionModeForProvider(targetProvider);
  }, [getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  /**
   * Re-seeds a new chat from the default set in Settings, so that default beats
   * the last-used model `selectProviderModel` records. Keyed on the session id
   * rather than running continuously: it fires when a chat is opened or cleared,
   * so a model picked before the first send survives.
   */
  useEffect(() => {
    if (selectedSession?.id) {
      return;
    }

    const configuredDefault = readProviderDefaultModel(provider);
    const options = providerModelCatalog[provider]?.OPTIONS;
    if (!configuredDefault || !options?.some((option) => option.value === configuredDefault)) {
      return;
    }

    setStoredProviderModel(provider, configuredDefault);
  }, [provider, providerModelCatalog, selectedSession?.id, setStoredProviderModel]);

  /**
   * Applies a model choice.
   *
   * The pick becomes the per-provider last-used model so the next new chat
   * inherits it when no default is configured, and — when a session is open —
   * is also recorded against that session so reopening it later restores this
   * model.
   */
  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    setStoredProviderModel(targetProvider, model);

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return { scope: 'default' as const, model };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );

    const body = (await response.json()) as SessionModelApiResponse;
    if (!response.ok || !body.success) {
      throw new Error('Unable to change the active model for this session.');
    }

    const storedModel = body.data?.model?.trim() || model;
    return { scope: 'session' as const, model: storedModel };
  }, [setStoredProviderModel]);

  /**
   * Applies an effort choice.
   *
   * Mirrors `selectProviderModel`: the value becomes the per-provider seed so
   * the next new chat inherits it, and — when a session is open — is recorded
   * against that session so it survives a reload and stays that session's
   * alone. A provider without effort support reports it rather than throwing;
   * its controls are hidden anyway.
   */
  const selectProviderEffort = useCallback(async (
    targetProvider: LLMProvider,
    effort: string,
    sessionId?: string | null,
  ) => {
    setStoredProviderEffort(targetProvider, effort);

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return { scope: 'default' as const, effort };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/effort`,
      {
        method: 'POST',
        body: JSON.stringify({ effort }),
      },
    );

    const body = (await response.json()) as SessionEffortApiResponse;
    if (!response.ok || !body.success) {
      throw new Error('Unable to change the reasoning effort for this session.');
    }

    // A session with no row yet (a brand-new chat before its first send) is not
    // a failure: the seed still applies, and the promotion runs once the id
    // exists.
    const storedEffort = body.data?.effort?.trim();
    return storedEffort
      ? { scope: 'session' as const, effort: storedEffort }
      : { scope: 'default' as const, effort };
  }, [setStoredProviderEffort]);

  // The open session's model wins over the per-provider default, so switching
  // sessions shows (and sends) what each session actually runs with.
  const currentProviderModel = sessionModel ?? providerModels[provider];
  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, currentProviderModel);
  }, [currentProviderModel, getEffortOptionsForModel, provider]);
  // As with the model: the open session's own effort wins over the provider
  // seed, so switching sessions shows and sends what each one runs with.
  const currentProviderEffort = useMemo(() => {
    return reconcileStoredEffort(
      provider,
      currentProviderModel,
      sessionEffort ?? providerEfforts[provider] ?? DEFAULT_EFFORT_VALUE,
    );
  }, [currentProviderModel, provider, providerEfforts, reconcileStoredEffort, sessionEffort]);
  const currentProviderModelOptions = useMemo(
    () => providerModelCatalog[provider]?.OPTIONS ?? [],
    [provider, providerModelCatalog],
  );

  return {
    provider,
    setProvider,
    selectProvider,
    availableProviders: PROVIDERS,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,
    opencodeModel,
    setOpenCodeModel,
    permissionMode,
    setPermissionMode,
    collaborationMode: currentCollaborationMode,
    availableCollaborationModes,
    selectCollaborationMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    selectPermissionMode,
    togglePermissionMode,
    providerModelCatalog,
    providerModelsLoading,
    selectProviderModel,
    selectProviderEffort,
    setStoredProviderEffort,
    reconcileStoredEffort,
    resolvePermissionModeForProvider,
    getSupportsRewindForProvider,
    getSupportsForkForProvider,
  };
}
