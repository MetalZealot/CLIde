import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {
  CLAUDE_SYNCED_MARKETPLACE,
  listClaudePluginInstalls,
  listClaudePluginServerNames,
  listClaudePluginSkills,
} from '@/modules/providers/list/claude/claude-plugins.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderTools } from '@/shared/interfaces.js';
import type {
  ProviderConnector,
  ProviderConnectorState,
  ProviderPlugin,
  ProviderSkillListOptions,
} from '@/shared/types.js';

// Health-checks every server; 6 s measured with 38 servers, 2026-09-23.
const MCP_LIST_TIMEOUT_MS = 60_000;

const MARKETPLACE_LABELS: Record<string, string> = {
  [CLAUDE_SYNCED_MARKETPLACE]: 'Synced from claude.ai',
  'claude-plugins-official': 'Claude official',
};

type StatusRule = { pattern: RegExp; state: ProviderConnectorState };

// Status words printed by `claude mcp list`, decoded from the CLI binary 2.1.280.
const STATUS_RULES: StatusRule[] = [
  { pattern: /^[✔✓] Connected$/u, state: 'connected' },
  { pattern: /^! Connected · tools fetch failed/u, state: 'failed' },
  { pattern: /^! Needs authentication/u, state: 'needs-auth' },
  { pattern: /^- Not configured/u, state: 'not-configured' },
  { pattern: /^⊘ Disabled/u, state: 'disabled' },
  { pattern: /^[✘✗×] (Failed to connect|Connection error)/u, state: 'failed' },
];

// A server that cannot register a client can never be signed into from Claude Code.
const CANNOT_AUTH = /dynamic client registration|Incompatible auth server/i;

const STATUS_SEPARATOR = / - (?=[✔✓!✘✗×⊘-] )/gu;

/**
 * Parses one `name: target - status[ — issue]` line. The name ends at the first
 * `: `; the status starts after the last ` - ` followed by a status symbol,
 * since a stdio target's arguments may contain ` - ` themselves.
 */
export const parseClaudeMcpListLine = (line: string): ProviderConnector | null => {
  const nameEnd = line.indexOf(': ');
  if (nameEnd <= 0) {
    return null;
  }

  // An unrecognised status symbol falls back to the last plain ` - `, so it is shown as unknown.
  const statusStart = [...line.matchAll(STATUS_SEPARATOR)].at(-1)?.index ?? line.lastIndexOf(' - ');
  if (statusStart < nameEnd) {
    return null;
  }

  const id = line.slice(0, nameEnd);
  const statusText = line.slice(statusStart + 3).trim();
  const rule = STATUS_RULES.find((candidate) => candidate.pattern.test(statusText));
  let state: ProviderConnectorState = rule?.state ?? 'unknown';
  if (state === 'failed' && CANNOT_AUTH.test(statusText)) {
    state = 'cannot-auth';
  }

  const pluginMatch = /^plugin:([^:]+):(.+)$/.exec(id);
  if (pluginMatch) {
    return { id, name: pluginMatch[2], origin: 'plugin', pluginName: pluginMatch[1], state, detail: statusText };
  }
  if (id.startsWith('claude.ai ')) {
    return { id, name: id.slice('claude.ai '.length), origin: 'account', state, detail: statusText };
  }
  return { id, name: id, origin: 'user', state, detail: statusText };
};

export const parseClaudeMcpList = (output: string): ProviderConnector[] =>
  output
    .split('\n')
    .map((line) => parseClaudeMcpListLine(line.trimEnd()))
    .filter((connector): connector is ProviderConnector => connector !== null);

const runClaudeMcpList = (cwd: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(resolveClaudeCodeExecutablePath(), ['mcp', 'list'], {
    cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: MCP_LIST_TIMEOUT_MS,
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.resume();
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolve(stdout);
    else reject(new Error(`claude mcp list exited ${code}`));
  });
});

export class ClaudeToolsProvider implements IProviderTools {
  constructor(private readonly runMcpList: (cwd: string) => Promise<string> = runClaudeMcpList) {}

  async listPlugins(options?: ProviderSkillListOptions): Promise<ProviderPlugin[]> {
    const workspacePath = options?.workspacePath ? path.resolve(options.workspacePath) : undefined;
    const installs = await listClaudePluginInstalls(path.join(os.homedir(), '.claude'), workspacePath);
    const plugins = new Map<string, ProviderPlugin>();

    for (const install of installs) {
      // One plugin can be installed at user and project scope; the listing names it once.
      const existing = plugins.get(install.pluginId);
      if (existing) {
        existing.enabled ||= install.enabled;
        continue;
      }

      const skills = await listClaudePluginSkills('claude', install);
      plugins.set(install.pluginId, {
        id: install.pluginId,
        name: install.pluginName,
        description: install.description,
        marketplace: install.marketplace,
        marketplaceLabel: MARKETPLACE_LABELS[install.marketplace] ?? install.marketplace,
        enabled: install.enabled,
        version: install.version,
        skills: skills.map(({ name, command, description }) => ({ name, command, description })),
        connectors: await listClaudePluginServerNames(install),
      });
    }

    return [...plugins.values()];
  }

  async listConnectors(options?: ProviderSkillListOptions): Promise<ProviderConnector[]> {
    const cwd = options?.workspacePath ? path.resolve(options.workspacePath) : os.homedir();
    return parseClaudeMcpList(await this.runMcpList(cwd));
  }
}
