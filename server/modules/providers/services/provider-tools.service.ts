import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  ProviderCommand,
  ProviderConnector,
  ProviderPlugin,
  ProviderSkillListOptions,
} from '@/shared/types.js';

// Both reads can take seconds (a health check of every server, or one plugin
// read per install), so a page visit reuses them until asked to refresh.
const CACHE_TTL_MS = 5 * 60 * 1000;
// Each command read starts a `claude` (~230 MB for ~5 s), and the list changes
// only when skills or plugins do — which the skills scan already shows.
const COMMANDS_CACHE_TTL_MS = 30 * 60 * 1000;

type Supported<T> = { supported: boolean; checkedAt?: string } & T;
type CacheEntry<T> = { result?: T; expiresAt: number; inFlight?: Promise<T> };
type ToolsOptions = ProviderSkillListOptions & { refresh?: boolean };

const caches = new Map<string, CacheEntry<unknown>>();

const cached = <T>(key: string, refresh: boolean, load: () => Promise<T>, ttlMs = CACHE_TTL_MS): Promise<T> => {
  const entry = (caches.get(key) ?? { expiresAt: 0 }) as CacheEntry<T>;
  caches.set(key, entry);
  if (entry.inFlight) {
    return entry.inFlight;
  }
  if (!refresh && entry.result && Date.now() < entry.expiresAt) {
    return Promise.resolve(entry.result);
  }

  entry.inFlight = load()
    .then((result) => {
      entry.result = result;
      entry.expiresAt = Date.now() + ttlMs;
      return result;
    })
    .finally(() => { entry.inFlight = undefined; });
  return entry.inFlight;
};

export const providerToolsService = {
  /** Commands the provider's CLI runs from text, for the slash menu; unsupported keeps the menu's own. */
  async listCommands(
    providerName: string,
    options: ToolsOptions = {},
  ): Promise<Supported<{ commands: ProviderCommand[] }>> {
    const tools = providerRegistry.resolveProvider(providerName).tools;
    if (!tools?.listCommands) {
      return { supported: false, commands: [] };
    }
    const listCommands = tools.listCommands.bind(tools);
    return cached(`commands\0${providerName}\0${options.workspacePath ?? ''}`, Boolean(options.refresh), async () => ({
      supported: true,
      commands: await listCommands({ workspacePath: options.workspacePath }),
      checkedAt: new Date().toISOString(),
    }), COMMANDS_CACHE_TTL_MS);
  },

  async listPlugins(
    providerName: string,
    options: ToolsOptions = {},
  ): Promise<Supported<{ plugins: ProviderPlugin[] }>> {
    const tools = providerRegistry.resolveProvider(providerName).tools;
    if (!tools) {
      return { supported: false, plugins: [] };
    }
    return cached(`plugins\0${providerName}\0${options.workspacePath ?? ''}`, Boolean(options.refresh), async () => ({
      supported: true,
      plugins: await tools.listPlugins({ workspacePath: options.workspacePath }),
      checkedAt: new Date().toISOString(),
    }));
  },

  async listConnectors(
    providerName: string,
    options: ToolsOptions = {},
  ): Promise<Supported<{ connectors: ProviderConnector[] }>> {
    const tools = providerRegistry.resolveProvider(providerName).tools;
    if (!tools) {
      return { supported: false, connectors: [] };
    }
    return cached(`connectors\0${providerName}\0${options.workspacePath ?? ''}`, Boolean(options.refresh), async () => ({
      supported: true,
      connectors: await tools.listConnectors({ workspacePath: options.workspacePath }),
      checkedAt: new Date().toISOString(),
    }));
  },
};
