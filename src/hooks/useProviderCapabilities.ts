import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../utils/api';
import type { LLMProvider } from '../types/app';

/**
 * Client mirror of the backend capability matrix
 * (server/modules/providers/services/provider-capabilities.service.ts).
 *
 * Every field is optional past the identity ones: an older server, or a future
 * one that drops a flag, must degrade to the caller's fallback rather than
 * crash. Callers read a flag from here instead of branching on the provider id.
 */
export type ProviderCapabilities = {
  provider: LLMProvider;
  permissionModes: string[];
  defaultPermissionMode: string;
  collaborationModes?: string[];
  defaultCollaborationMode?: string | null;
  supportsImages?: boolean;
  supportsFiles?: boolean;
  supportsAbort?: boolean;
  supportsPermissionRequests?: boolean;
  supportsTokenUsage?: boolean;
  supportsUsageResetAlerts?: boolean;
  supportsEffort?: boolean;
  supportsRewind?: boolean;
  supportsFork?: boolean;
  supportsCompactCommand?: boolean;
};

export type ProviderCapabilityMap = Partial<Record<LLMProvider, ProviderCapabilities>>;

type ProviderCapabilitiesApiResponse = {
  success?: boolean;
  data?: {
    providers?: ProviderCapabilities[];
  };
};

// The matrix is static for the life of the server process apart from Codex's
// runtime probe, so the cache answers instantly for surfaces opened later while
// the mount request still revalidates. One in-flight request serves them all.
let capabilityCache: ProviderCapabilityMap | null = null;
let capabilityRequest: Promise<ProviderCapabilityMap> | null = null;

const loadProviderCapabilities = (): Promise<ProviderCapabilityMap> => {
  if (capabilityRequest) {
    return capabilityRequest;
  }

  const request = (async (): Promise<ProviderCapabilityMap> => {
    const response = await authenticatedFetch('/api/providers/capabilities');
    const body = (await response.json()) as ProviderCapabilitiesApiResponse;
    if (!body.success || !Array.isArray(body.data?.providers)) {
      throw new Error('Failed to load provider capabilities');
    }

    const byProvider: ProviderCapabilityMap = {};
    for (const capabilities of body.data.providers) {
      byProvider[capabilities.provider] = capabilities;
    }
    capabilityCache = byProvider;
    return byProvider;
  })();

  capabilityRequest = request;
  void request.finally(() => {
    if (capabilityRequest === request) {
      capabilityRequest = null;
    }
  });

  return request;
};

/**
 * Reads the backend capability matrix, keyed by provider. Returns `null` until
 * the first response arrives, so callers can hold their own fallback until then.
 */
export function useProviderCapabilities(): ProviderCapabilityMap | null {
  const [capabilities, setCapabilities] = useState<ProviderCapabilityMap | null>(capabilityCache);

  useEffect(() => {
    let cancelled = false;
    void loadProviderCapabilities()
      .then((next) => {
        if (!cancelled) setCapabilities(next);
      })
      .catch((error: unknown) => {
        console.error('Error loading provider capabilities:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return capabilities;
}
