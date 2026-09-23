import path from 'node:path';

import { resolveSelectedCodexRuntimeCommand } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';
import { JsonlRpcClient } from '@/modules/providers/shared/jsonl-rpc.client.js';
import type { IProviderTools } from '@/shared/interfaces.js';
import type {
  ProviderConnector,
  ProviderConnectorState,
  ProviderPlugin,
  ProviderSkillListOptions,
} from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

const REQUEST_TIMEOUT_MS = 60_000;
/** Codex's gateway server for account apps; the apps are listed individually instead. */
const CODEX_APPS_SERVER = 'codex_apps';

export type CodexToolsSession = {
  request: (method: string, params: unknown) => Promise<unknown>;
  close: () => void;
};

const openCodexToolsSession = async (cwd?: string): Promise<CodexToolsSession> => {
  // Read-only catalog calls share the runtime chosen for the model catalog.
  const { command } = await resolveSelectedCodexRuntimeCommand('models', ['app-server', '--stdio']);
  const client = new JsonlRpcClient({ command, cwd, requestTimeoutMs: REQUEST_TIMEOUT_MS });
  client.open();
  try {
    await client.request('initialize', {
      clientInfo: { name: 'clide', title: 'CLIde', version: '1' },
      capabilities: { experimentalApi: true },
    });
    client.notify('initialized', {});
  } catch (error) {
    client.close('Codex tools handshake failed.');
    throw error;
  }
  return {
    request: (method, params) => client.request(method, params),
    close: () => client.close('Codex tools read completed.'),
  };
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const RUNTIME_STATES: Record<string, ProviderConnectorState> = {
  connected: 'connected',
  authenticationRequired: 'needs-auth',
  failed: 'failed',
  disabled: 'disabled',
};

/**
 * Outside a thread `runtimeStatus` is null, so a server that answered the
 * tools request counts as connected and `notLoggedIn` as awaiting sign-in.
 */
export const mapCodexServerState = (status: Record<string, unknown>): ProviderConnectorState => {
  const runtime = readOptionalString(status.runtimeStatus);
  if (runtime && RUNTIME_STATES[runtime]) {
    return RUNTIME_STATES[runtime];
  }
  if (status.authStatus === 'notLoggedIn') {
    return 'needs-auth';
  }
  if (readOptionalString(status.toolsError)) {
    return 'failed';
  }
  return Object.keys(readObjectRecord(status.tools) ?? {}).length > 0 ? 'connected' : 'unknown';
};

export class CodexToolsProvider implements IProviderTools {
  constructor(
    private readonly openSession: (cwd?: string) => Promise<CodexToolsSession> = openCodexToolsSession,
  ) {}

  async listPlugins(options?: ProviderSkillListOptions): Promise<ProviderPlugin[]> {
    const cwd = options?.workspacePath ? path.resolve(options.workspacePath) : undefined;
    const session = await this.openSession(cwd);
    try {
      const listed = readObjectRecord(await session.request('plugin/list', cwd ? { cwds: [cwd] } : {})) ?? {};
      const reads: Promise<ProviderPlugin | null>[] = [];

      for (const marketplaceEntry of asArray(listed.marketplaces)) {
        const marketplace = readObjectRecord(marketplaceEntry) ?? {};
        const marketplaceName = readOptionalString(marketplace.name) ?? '';
        const marketplacePath = readOptionalString(marketplace.path);
        const marketplaceLabel = readOptionalString(readObjectRecord(marketplace.interface)?.displayName)
          ?? marketplaceName;

        // A remote catalog lists thousands of plugins; only installed ones are the user's.
        for (const pluginEntry of asArray(marketplace.plugins)) {
          const summary = readObjectRecord(pluginEntry) ?? {};
          const pluginName = readOptionalString(summary.name);
          if (summary.installed !== true || !pluginName) {
            continue;
          }

          const readParams = marketplacePath
            ? { marketplacePath, pluginName }
            : { remoteMarketplaceName: marketplaceName, pluginName };
          reads.push(session.request('plugin/read', readParams).then((response) => {
            const detail = readObjectRecord(readObjectRecord(response)?.plugin) ?? {};
            const face = readObjectRecord(summary.interface) ?? {};
            return {
              id: readOptionalString(summary.id) ?? `${pluginName}@${marketplaceName}`,
              name: readOptionalString(face.displayName) ?? pluginName,
              description: readOptionalString(face.shortDescription) ?? readOptionalString(detail.description) ?? '',
              marketplace: marketplaceName,
              marketplaceLabel,
              enabled: summary.enabled === true,
              version: readOptionalString(summary.localVersion) ?? readOptionalString(summary.version),
              skills: asArray(detail.skills)
                .map((entry) => readObjectRecord(entry) ?? {})
                .filter((skill) => skill.enabled !== false && readOptionalString(skill.name))
                .map((skill) => ({
                  name: readOptionalString(skill.name)!,
                  command: `$${readOptionalString(skill.name)}`,
                  description: readOptionalString(skill.shortDescription) ?? readOptionalString(skill.description) ?? '',
                })),
              connectors: [
                ...asArray(detail.mcpServers).filter((name): name is string => typeof name === 'string'),
                ...asArray(detail.apps)
                  .map((app) => readOptionalString(readObjectRecord(app)?.name))
                  .filter((name): name is string => Boolean(name)),
              ],
            };
          }).catch(() => null));
        }
      }

      return (await Promise.all(reads)).filter((plugin): plugin is ProviderPlugin => plugin !== null);
    } finally {
      session.close();
    }
  }

  async listConnectors(options?: ProviderSkillListOptions): Promise<ProviderConnector[]> {
    const cwd = options?.workspacePath ? path.resolve(options.workspacePath) : undefined;
    const session = await this.openSession(cwd);
    try {
      const connectors: ProviderConnector[] = [];
      let cursor: string | undefined;
      do {
        const page = readObjectRecord(await session.request('mcpServerStatus/list', {
          detail: 'toolsAndAuthOnly',
          ...(cursor ? { cursor } : {}),
        })) ?? {};
        for (const entry of asArray(page.data)) {
          const status = readObjectRecord(entry) ?? {};
          const name = readOptionalString(status.name);
          if (!name || name === CODEX_APPS_SERVER) {
            continue;
          }
          const pluginName = readOptionalString(status.pluginId)?.split('@')[0];
          connectors.push({
            id: name,
            name,
            origin: pluginName ? 'plugin' : 'user',
            pluginName,
            state: mapCodexServerState(status),
            detail: readOptionalString(status.toolsError),
          });
        }
        cursor = readOptionalString(page.nextCursor);
      } while (cursor);

      const installed = readObjectRecord(await session.request('app/installed', {})) ?? {};
      for (const entry of asArray(installed.apps)) {
        const app = readObjectRecord(entry) ?? {};
        const id = readOptionalString(app.id);
        if (!id) {
          continue;
        }
        let state: ProviderConnectorState = 'disabled';
        if (app.enabled === true) {
          state = app.callable === true ? 'connected' : 'unknown';
        }
        connectors.push({ id, name: readOptionalString(app.runtimeName) ?? id, origin: 'account', state });
      }

      return connectors;
    } finally {
      session.close();
    }
  }
}
