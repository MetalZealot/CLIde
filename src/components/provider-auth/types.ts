import type { LLMProvider } from '../../types/app';

/**
 * Local toolchain versions a provider reports. Claude sends its Agent SDK and
 * the `claude` binary CLIde spawns, which move independently, plus the pair
 * this one replaced. Null for providers that report nothing.
 */
export type ProviderRuntimeVersions = {
  runtime: string | null;
  sdk: string | null;
  observedAt: string;
  previous?: {
    runtime: string | null;
    sdk: string | null;
    observedAt: string;
  };
};

export type ProviderAuthStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  loading: boolean;
  versions: ProviderRuntimeVersions | null;
};

export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

export const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<LLMProvider, string> = {
  claude: '/api/providers/claude/auth/status',
  cursor: '/api/providers/cursor/auth/status',
  codex: '/api/providers/codex/auth/status',
  opencode: '/api/providers/opencode/auth/status',
};

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { authenticated: false, email: null, method: null, error: null, loading, versions: null },
  cursor: { authenticated: false, email: null, method: null, error: null, loading, versions: null },
  codex: { authenticated: false, email: null, method: null, error: null, loading, versions: null },
  opencode: { authenticated: false, email: null, method: null, error: null, loading, versions: null },
});
