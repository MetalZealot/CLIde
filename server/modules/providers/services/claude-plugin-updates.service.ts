import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { readJsonConfig, readObjectRecord, readOptionalString } from '@/shared/utils.js';

import type { ClaudePluginUpdateStatus } from '../../../../shared/provider-updates.js';

type InstalledPlugin = { id: string; scope: string; projectPath?: string; version?: string };
type PluginUpdateDependencies = {
  run: (args: string[], cwd: string) => Promise<string>;
  readLastUpdatedAt: () => Promise<string | null>;
  now: () => number;
};

/** Matches Claude Code's own background refresh cadence closely enough for a once-per-open check. */
export const PLUGIN_UPDATE_STALE_MS = 6 * 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

const runClaude = (args: string[], cwd: string): Promise<string> => new Promise((resolve, reject) => {
  // stdin ignored: a marketplace-declared command needing confirmation must fail, never be auto-accepted.
  const child = spawn(resolveClaudeCodeExecutablePath(), args, {
    cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: COMMAND_TIMEOUT_MS,
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.resume();
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolve(stdout);
    else reject(new Error(`claude ${args.slice(0, 2).join(' ')} exited ${code}`));
  });
});

const readMarketplacesLastUpdatedAt = async (): Promise<string | null> => {
  const config = await readJsonConfig(path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json'));
  let latest: string | null = null;
  for (const entry of Object.values(config)) {
    const value = readOptionalString(readObjectRecord(entry)?.lastUpdated);
    if (value && !Number.isNaN(Date.parse(value)) && (!latest || Date.parse(value) > Date.parse(latest))) {
      latest = value;
    }
  }
  return latest;
};

const parseInstalledPlugins = (stdout: string): InstalledPlugin[] => {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const record = readObjectRecord(entry);
    const id = readOptionalString(record?.id);
    const scope = readOptionalString(record?.scope);
    if (!id || !scope) return [];
    return [{ id, scope, projectPath: readOptionalString(record?.projectPath), version: readOptionalString(record?.version) }];
  });
};

const installKey = (plugin: InstalledPlugin) => `${plugin.id}\0${plugin.scope}\0${plugin.projectPath ?? ''}`;

/** Refreshes Claude marketplaces, then updates every installed plugin, one run at a time. */
export class ClaudePluginUpdatesService {
  private state: ClaudePluginUpdateStatus['state'] = 'idle';
  private message: string | null = null;
  private updatedPlugins = 0;
  private lastAttemptAt = 0;
  private job: Promise<void> | null = null;

  constructor(private readonly dependencies: PluginUpdateDependencies) {}

  async getStatus(): Promise<ClaudePluginUpdateStatus> {
    let lastUpdatedAt: string | null = null;
    try { lastUpdatedAt = await this.dependencies.readLastUpdatedAt(); } catch { /* Shown as never updated. */ }
    return { state: this.state, lastUpdatedAt, updatedPlugins: this.updatedPlugins, message: this.message };
  }

  /** With `ifStale`, does nothing when marketplaces or the last attempt are newer than the stale window. */
  async startUpdate(options: { ifStale?: boolean } = {}): Promise<ClaudePluginUpdateStatus> {
    if (!this.job && options.ifStale) {
      const status = await this.getStatus();
      const fileTime = status.lastUpdatedAt ? Date.parse(status.lastUpdatedAt) : 0;
      if (this.dependencies.now() - Math.max(fileTime, this.lastAttemptAt) < PLUGIN_UPDATE_STALE_MS) return status;
    }
    if (!this.job) {
      this.lastAttemptAt = this.dependencies.now();
      this.state = 'updating';
      this.message = null;
      this.job = this.update().finally(() => { this.job = null; });
    }
    return this.getStatus();
  }

  /** Resolves when the current run, if any, finishes. */
  async settled(): Promise<void> {
    await this.job;
  }

  private async update(): Promise<void> {
    const home = os.homedir();
    try {
      await this.dependencies.run(['plugin', 'marketplace', 'update'], home);
      const before = parseInstalledPlugins(await this.dependencies.run(['plugin', 'list', '--json'], home));
      const seen = new Set<string>();
      let failed = 0;
      for (const plugin of before) {
        if (plugin.scope === 'managed' || seen.has(installKey(plugin))) continue;
        seen.add(installKey(plugin));
        const cwd = plugin.scope === 'user' ? home : plugin.projectPath;
        if (!cwd) continue;
        try {
          await this.dependencies.run(['plugin', 'update', plugin.id, '--scope', plugin.scope], cwd);
        } catch {
          failed += 1;
        }
      }
      const after = parseInstalledPlugins(await this.dependencies.run(['plugin', 'list', '--json'], home));
      const previous = new Map(before.map((plugin) => [installKey(plugin), plugin.version]));
      this.updatedPlugins = after.filter((plugin) => {
        const version = previous.get(installKey(plugin));
        return version !== undefined && version !== plugin.version;
      }).length;
      this.state = failed ? 'error' : 'idle';
      this.message = failed ? `${failed} plugin${failed === 1 ? '' : 's'} could not be updated.` : null;
    } catch {
      this.state = 'error';
      this.message = 'Could not update Claude plugins. Try again later.';
    }
  }
}

export const claudePluginUpdatesService = new ClaudePluginUpdatesService({
  run: runClaude,
  readLastUpdatedAt: readMarketplacesLastUpdatedAt,
  now: Date.now,
});
