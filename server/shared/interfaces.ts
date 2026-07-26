import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  McpScope,
  NormalizedMessage,
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderAuthStatus,
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderMcpServer,
  ProviderSessionActiveModelChange,
  ProviderSkillCreateInput,
  ProviderSkillRemoveInput,
  ProviderUsageStatus,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';

//----------------- PROVIDER CONTRACT INTERFACES ------------
/**
 * Main provider contract for CLI and SDK integrations.
 *
 * Each concrete provider owns its MCP/auth handlers plus the provider-specific
 * logic for converting native events/history into the app's normalized shape.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly models: IProviderModels;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
  /**
   * Optional plan-usage reporter. Providers without a plan-usage concept simply
   * omit this member and the usage endpoint reports `supported: false`.
   */
  readonly usage?: IProviderUsage;
}

// ---------------------------
//----------------- PROVIDER MODEL INTERFACE ------------
/**
 * Model catalog contract for one provider.
 *
 * Implementations are responsible for resolving the provider's currently
 * supported models and converting them into the shared
 * `ProviderModelsDefinition` shape used by backend routes and frontend model
 * pickers. The `DEFAULT` field should be the most appropriate default selection
 * for that provider at the time the catalog is read.
 */
export interface IProviderModels {
  /**
   * Returns the provider's currently supported model catalog.
   */
  getSupportedModels(): Promise<ProviderModelsDefinition>;

  /**
   * Returns the currently active model for one session or provider runtime.
   *
   * Implementations must use the provider-specific lookup mechanism approved
   * for that provider and fall back only to the provider catalog default when
   * no active model can be resolved.
   */
  getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel>;

  /**
   * Persists a session-scoped model override that the next resumed turn should
   * honor for this provider.
   *
   * This does not require the provider to mutate an already running remote
   * session in-place. Instead, adapters store the user's explicit model choice
   * so the backend resume path can add the correct provider-native model option
   * on the next CLI/SDK invocation for the same session.
   */
  changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange>;

  /**
   * Returns the timestamp of the most recent transcript turn for this session,
   * when the provider has a transcript concept to compare a cached model pick
   * against. Providers without one should omit this method.
   */
  getTranscriptTurnTimestamp?(sessionId: string): Promise<string | undefined>;
}

// ---------------------------
//----------------- PROVIDER AUTH INTERFACE ------------
/**
 * Auth contract for one provider.
 *
 * Implementations should return a complete installation/authentication status
 * without throwing for normal "not installed" or "not authenticated" states.
 */
export interface IProviderAuth {
  /**
   * Checks whether the provider is installed and has usable credentials.
   */
  getStatus(): Promise<ProviderAuthStatus>;
}

// ---------------------------
//----------------- PROVIDER USAGE INTERFACE ------------
/**
 * Plan-usage contract for one provider.
 *
 * Implementations report plan rate-limit windows (e.g. 5-hour/weekly
 * utilization) plus optional provider activity/reset-credit data, and must not
 * throw for normal "unsupported auth method" or "not authenticated" states —
 * encode those in the returned status instead.
 */
export interface IProviderUsage {
  /**
   * Fetches the provider's current plan usage from its upstream source.
   * Caching is the usage service's responsibility, not the provider's.
   */
  getUsage(): Promise<ProviderUsageStatus>;
}

// ---------------------------
//----------------- PROVIDER SKILLS INTERFACE ------------
/**
 * Skills contract for one provider.
 *
 * Implementations discover provider-native skill markdown locations and return
 * normalized skill records with the exact command syntax expected by that
 * provider. Each skill is read from a `SKILL.md` file under its skill directory.
 */
export interface IProviderSkills {
  /**
   * Lists all skills visible to this provider for the optional workspace.
   */
  listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]>;

  /**
   * Writes one or more global user-scoped skills for this provider.
   *
   * Implementations should install the supplied markdown entries into the
   * provider's writable user skill folder and return the normalized skill
   * records that were written.
   */
  addSkills(input: ProviderSkillCreateInput): Promise<ProviderSkill[]>;

  removeSkill(
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: LLMProvider; directoryName: string }>;
}

// ---------------------------
//----------------- PROVIDER MCP INTERFACE ------------
/**
 * MCP contract for one provider.
 *
 * Implementations must map provider-native MCP config formats to shared
 * `ProviderMcpServer` records used by routes and frontend state.
 */
export interface IProviderMcp {
  listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>>;
  listServersForScope(scope: McpScope, options?: { workspacePath?: string }): Promise<ProviderMcpServer[]>;
  upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer>;
  removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }>;
}

// ---------------------------
//----------------- PROVIDER SESSION INTERFACE ------------
/**
 * Session/history contract for one provider.
 *
 * Implementations normalize provider-specific events and message history into
 * shared transport shapes consumed by API routes and realtime streams.
 */
export interface IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;
  /**
   * Creates a provider-native sibling conversation without starting a turn.
   *
   * The service layer owns the separate stable CLIde session id; providers
   * only return the native id and transcript hints needed to index the fork.
   */
  forkSession?(
    providerSessionId: string,
    options?: {
      projectPath?: string;
      model?: string;
      permissionMode?: string;
      /** Provider-native completed turn through which history is copied. */
      lastTurnId?: string;
    },
  ): Promise<{
    providerSessionId: string;
    projectPath?: string;
    jsonlPath?: string | null;
  }>;
}

// ---------------------------
//----------------- PROVIDER SESSION SYNCHRONIZER INTERFACE ------------
/**
 * Session indexing contract for one provider.
 *
 * Implementations scan provider-specific session artifacts on disk and upsert
 * normalized session metadata into the database. The service layer uses this
 * interface for both full rescans and single-file incremental sync triggered
 * by filesystem watcher events.
 */
export interface IProviderSessionSynchronizer {
  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(since?: Date): Promise<number>;

  /**
   * Parses and upserts one provider artifact file without running a full scan.
   */
  synchronizeFile(filePath: string): Promise<string | null>;
}
