import { createRequire } from 'node:module';

export type CodexChatTransport = 'app-server' | 'sdk';
export type CodexChatTransportHealth =
  | 'disabled'
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'fallback';

export type CodexChatTransportDiagnostics = {
  configured: CodexChatTransport;
  actual: CodexChatTransport;
  health: CodexChatTransportHealth;
  bundledCliVersion: string | null;
  lastError: string | null;
  lastStartupFallbackAt: string | null;
};

type RuntimeState = {
  health: Exclude<CodexChatTransportHealth, 'disabled'>;
  lastError: string | null;
  lastStartupFallbackAt: string | null;
};

const moduleRequire = createRequire(import.meta.url);
const runtimeState: RuntimeState = {
  health: 'idle',
  lastError: null,
  lastStartupFallbackAt: null,
};

const bundledCliVersion = (() => {
  try {
    const manifest = moduleRequire('@openai/codex/package.json') as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
})();

/**
 * App Server is the normal interactive Chat transport. `sdk` is retained as
 * an explicit emergency escape hatch; the legacy `app-server` value remains
 * accepted so existing deployments do not need a coordinated env cleanup.
 */
export function getConfiguredCodexChatTransport(): CodexChatTransport {
  return process.env.CLIDE_CODEX_CHAT_TRANSPORT === 'sdk' ? 'sdk' : 'app-server';
}

export function isCodexAppServerChatEnabled(): boolean {
  return getConfiguredCodexChatTransport() === 'app-server';
}

export function markCodexAppServerStarting(): void {
  runtimeState.health = 'starting';
  runtimeState.lastError = null;
}

export function markCodexAppServerReady(): void {
  runtimeState.health = 'ready';
  runtimeState.lastError = null;
}

export function markCodexAppServerStopped(error: unknown): void {
  runtimeState.health = 'stopped';
  runtimeState.lastError = error instanceof Error ? error.message : String(error);
}

export function markCodexAppServerStartupFallback(error: unknown): void {
  runtimeState.health = 'fallback';
  runtimeState.lastError = error instanceof Error ? error.message : String(error);
  runtimeState.lastStartupFallbackAt = new Date().toISOString();
}

export function getCodexChatTransportDiagnostics(): CodexChatTransportDiagnostics {
  const configured = getConfiguredCodexChatTransport();
  if (configured === 'sdk') {
    return {
      configured,
      actual: 'sdk',
      health: 'disabled',
      bundledCliVersion,
      lastError: null,
      lastStartupFallbackAt: runtimeState.lastStartupFallbackAt,
    };
  }

  return {
    configured,
    actual: runtimeState.health === 'fallback' ? 'sdk' : 'app-server',
    health: runtimeState.health,
    bundledCliVersion,
    lastError: runtimeState.lastError,
    lastStartupFallbackAt: runtimeState.lastStartupFallbackAt,
  };
}

export function codexAppServerRuntimeCapabilitiesAvailable(): boolean {
  const diagnostics = getCodexChatTransportDiagnostics();
  return diagnostics.configured === 'app-server' && diagnostics.actual === 'app-server';
}

export function resetCodexChatTransportStateForTests(): void {
  runtimeState.health = 'idle';
  runtimeState.lastError = null;
  runtimeState.lastStartupFallbackAt = null;
}
