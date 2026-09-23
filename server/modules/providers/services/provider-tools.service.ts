import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  ProviderConnector,
  ProviderPlugin,
  ProviderSkillListOptions,
} from '@/shared/types.js';

// Connector status costs a health check of every server, so a page visit reuses it.
const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000;

type ConnectorsResult = { supported: boolean; connectors: ProviderConnector[]; checkedAt?: string };
type CacheEntry = { result?: ConnectorsResult; expiresAt: number; inFlight?: Promise<ConnectorsResult> };

const connectorCache = new Map<string, CacheEntry>();

export const providerToolsService = {
  async listPlugins(
    providerName: string,
    options?: ProviderSkillListOptions,
  ): Promise<{ supported: boolean; plugins: ProviderPlugin[] }> {
    const tools = providerRegistry.resolveProvider(providerName).tools;
    if (!tools) {
      return { supported: false, plugins: [] };
    }
    return { supported: true, plugins: await tools.listPlugins(options) };
  },

  async listConnectors(
    providerName: string,
    options: ProviderSkillListOptions & { refresh?: boolean } = {},
  ): Promise<ConnectorsResult> {
    const tools = providerRegistry.resolveProvider(providerName).tools;
    if (!tools) {
      return { supported: false, connectors: [] };
    }

    const key = `${providerName}\0${options.workspacePath ?? ''}`;
    const entry = connectorCache.get(key) ?? { expiresAt: 0 };
    connectorCache.set(key, entry);
    if (entry.inFlight) {
      return entry.inFlight;
    }
    if (!options.refresh && entry.result && Date.now() < entry.expiresAt) {
      return entry.result;
    }

    entry.inFlight = tools.listConnectors({ workspacePath: options.workspacePath })
      .then((connectors) => {
        entry.result = { supported: true, connectors, checkedAt: new Date().toISOString() };
        entry.expiresAt = Date.now() + CONNECTOR_CACHE_TTL_MS;
        return entry.result;
      })
      .finally(() => { entry.inFlight = undefined; });
    return entry.inFlight;
  },
};
