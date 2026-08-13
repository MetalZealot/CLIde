import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export type RuntimeInstallation = {
  id: string;
  version: string;
  displayPath: string;
  sources: string[];
  bundled: boolean;
};

export type RuntimeStatus = {
  installations: RuntimeInstallation[];
  activeInstallationId: string | null;
  previousInstallationId: string | null;
  liveProcessInstallationId: string | null;
  sdkVersion: string | null;
  liveProcessVersion: string | null;
  updatePending: boolean;
  activeError: string | null;
};

export type RuntimeCompatibility = 'compatible' | 'incompatible' | 'check_failed';

export type RuntimeCheck = {
  installationId: string;
  compatibility: RuntimeCompatibility;
  detail: string | null;
};

export type CodexTransportKind = 'app-server' | 'sdk';

export type CodexTransportHealth =
  | 'disabled'
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'fallback';

export type CodexTransportDiagnostics = {
  configured: CodexTransportKind;
  actual: CodexTransportKind;
  health: CodexTransportHealth;
  sdkVersion: string | null;
  bundledCliVersion: string | null;
  lastError: string | null;
  lastStartupFallbackAt: string | null;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type CodexCapabilitiesResponse = {
  success?: boolean;
  data?: { chatTransport?: CodexTransportDiagnostics };
};

export const readRuntimeResponse = async <T,>(response: Response): Promise<T> => {
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error || 'Runtime request failed.');
  }
  return body.data;
};

export const toRuntimeErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

/**
 * The provider screen's Runtime row previews the active version and the Runtime
 * screen lists every installation, so both read this. A module cache keeps the
 * preview and the screen from disagreeing and makes drilling in instant;
 * mutations write through it rather than invalidating.
 */
let runtimeStatusCache: RuntimeStatus | null = null;
let transportCache: CodexTransportDiagnostics | null = null;

export const useCodexRuntimeStatus = (enabled: boolean) => {
  const [status, setStatus] = useState<RuntimeStatus | null>(enabled ? runtimeStatusCache : null);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = useCallback((next: RuntimeStatus) => {
    runtimeStatusCache = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;
    void authenticatedFetch('/api/providers/codex/runtime')
      .then(readRuntimeResponse<RuntimeStatus>)
      .then((next) => {
        if (!cancelled) applyStatus(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toRuntimeErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, applyStatus]);

  return { status, error, setError, applyStatus };
};

export const useCodexTransport = (enabled: boolean) => {
  const [transport, setTransport] = useState<CodexTransportDiagnostics | null>(
    enabled ? transportCache : null,
  );

  useEffect(() => {
    if (!enabled) {
      setTransport(null);
      return undefined;
    }

    let cancelled = false;
    void authenticatedFetch('/api/providers/codex/capabilities')
      .then(async (response) => {
        const body = (await response.json()) as CodexCapabilitiesResponse;
        if (!cancelled && body.success && body.data?.chatTransport) {
          transportCache = body.data.chatTransport;
          setTransport(body.data.chatTransport);
        }
      })
      .catch((error) => {
        console.error('Error loading Codex transport diagnostics:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return transport;
};

/** Chat is not running the way it was configured to, or failed while doing so. */
export const isTransportDegraded = (
  transport: CodexTransportDiagnostics | null,
): transport is CodexTransportDiagnostics => Boolean(
  transport
  && (transport.health === 'fallback' || transport.health === 'stopped' || transport.lastError),
);
