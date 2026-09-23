import { spawn } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { codexNativeRuntimeService } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';
import { providerUpdateCoordinator } from '@/modules/providers/services/provider-update-coordinator.service.js';
import { runProviderNativeRuntimeCommand } from '@/modules/providers/services/provider-native-runtime.service.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

import type { ProviderCliUpdateStatus } from '../../../../shared/provider-updates.js';

type UpdateProvider = ProviderCliUpdateStatus['provider'];
type Installation = { launcher: string; version: string; canUpdate: boolean };
type UpdateDependencies = {
  inspect: (provider: UpdateProvider) => Promise<Installation>;
  latest: (provider: UpdateProvider) => Promise<string>;
  install: (provider: UpdateProvider, installation: Installation) => Promise<void>;
  verify: (provider: UpdateProvider) => Promise<void>;
  coordinator: Pick<typeof providerUpdateCoordinator, 'update' | 'cancelWaiting'>;
  now: () => number;
};

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

const isNewer = (latest: string, installed: string): boolean => {
  const left = latest.split('-')[0].split('.').map(Number);
  const right = installed.split('-')[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return !latest.includes('-') && installed.includes('-');
};

const findLauncher = async (command: string): Promise<string> => {
  if (path.isAbsolute(command)) return command;
  if (command.includes(path.sep)) return path.resolve(command);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try { await access(candidate); return candidate; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error('CLI launcher unavailable.');
};

const inspectInstallation = async (provider: UpdateProvider): Promise<Installation> => {
  const launcher = provider === 'codex'
    ? await codexNativeRuntimeService.getLauncherPath()
    : await findLauncher(resolveClaudeCodeExecutablePath());
  const target = await realpath(launcher);
  const version = (await runProviderNativeRuntimeCommand(target, ['--version']))
    .match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0];
  if (!version) throw new Error('CLI version unavailable.');
  const nativeRoot = provider === 'codex'
    ? path.join(os.homedir(), '.codex', 'packages', 'standalone', 'releases')
    : path.join(os.homedir(), '.local', 'share', 'claude', 'versions');
  const relative = path.relative(nativeRoot, target);
  const nativeLauncher = path.join(os.homedir(), '.local', 'bin', provider);
  // Only invoke an updater whose managed launcher is the one CLIde follows.
  const canUpdate = process.platform !== 'win32' && launcher === nativeLauncher
    && Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  return { launcher, version, canUpdate };
};

const readClaudeChannel = async (): Promise<'stable' | 'latest'> => {
  let channel: 'stable' | 'latest' = 'latest';
  const settingsFiles = [
    path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json'),
    '/etc/claude-code/managed-settings.json',
  ];
  for (const filename of settingsFiles) {
    try {
      const settings = JSON.parse(await readFile(filename, 'utf8'));
      if (settings.autoUpdatesChannel === 'stable' || settings.autoUpdatesChannel === 'latest') {
        channel = settings.autoUpdatesChannel;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read the Claude update channel.');
    }
  }
  return channel;
};

const latestVersion = async (provider: UpdateProvider): Promise<string> => {
  const url = provider === 'codex'
    ? 'https://releases.openai.com/codex/channels/latest'
    : `https://downloads.claude.ai/claude-code-releases/${await readClaudeChannel()}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Release check failed.');
  const text = await response.text();
  const version: unknown = provider === 'codex'
    ? JSON.parse(text).tag_name?.replace(/^rust-v/, '') : text.trim();
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('Invalid release version.');
  return version;
};

/** Native update runner; also exercised with an isolated executable in provider tests. */
export const runNativeCliUpdate = async (_provider: UpdateProvider, installation: Installation): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(installation.launcher, ['update'], {
      cwd: os.homedir(),
      env: { ...process.env, CI: '1' },
      detached: true,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => {
      // Kill the updater's process group so a timed-out installer cannot keep writing.
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
    }, 5 * 60 * 1000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('Could not start the CLI updater. Check the installation.'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error('The CLI updater failed or timed out. Retry or check the installation.'));
    });
  });
};

/** Owns cached release checks and explicit, serialized updates for provider routes. */
export class ProviderCliUpdatesService {
  private readonly states = new Map<UpdateProvider, ProviderCliUpdateStatus>();
  private readonly checkedUntil = new Map<UpdateProvider, number>();
  private readonly checks = new Map<UpdateProvider, Promise<ProviderCliUpdateStatus>>();
  private readonly jobs = new Map<UpdateProvider, Promise<void>>();
  private readonly completedAt = new Map<UpdateProvider, number>();

  constructor(private readonly dependencies: UpdateDependencies) {}

  private status(provider: UpdateProvider): ProviderCliUpdateStatus {
    let status = this.states.get(provider);
    if (!status) {
      status = { provider, installedVersion: null, latestVersion: null, updateAvailable: false,
        canUpdate: false, state: 'idle', message: null };
      this.states.set(provider, status);
    }
    return status;
  }

  async getStatus(provider: UpdateProvider): Promise<ProviderCliUpdateStatus> {
    if (this.jobs.has(provider)) return { ...this.status(provider) };
    const existing = this.checks.get(provider);
    if (existing) return existing;
    const pending = this.check(provider).finally(() => this.checks.delete(provider));
    this.checks.set(provider, pending);
    return pending;
  }

  private async check(provider: UpdateProvider): Promise<ProviderCliUpdateStatus> {
    const status = this.status(provider);
    try {
      const installed = await this.dependencies.inspect(provider);
      status.installedVersion = installed.version;
      status.canUpdate = installed.canUpdate;
      if ((this.checkedUntil.get(provider) ?? 0) <= this.dependencies.now()) {
        status.latestVersion = await this.dependencies.latest(provider);
        this.checkedUntil.set(provider, this.dependencies.now() + CHECK_INTERVAL_MS);
      }
      status.updateAvailable = Boolean(status.latestVersion && isNewer(status.latestVersion, installed.version));
      if (status.state === 'updated' && (status.updateAvailable
        || this.dependencies.now() - (this.completedAt.get(provider) ?? 0) > RETRY_INTERVAL_MS)) {
        status.state = 'idle';
      }
      if (status.state === 'idle') status.message = null;
    } catch {
      this.checkedUntil.set(provider, this.dependencies.now() + RETRY_INTERVAL_MS);
      status.message = 'Could not check CLI updates. Try again later.';
    }
    return { ...status };
  }

  async startUpdate(provider: UpdateProvider): Promise<ProviderCliUpdateStatus> {
    if (this.jobs.has(provider)) return { ...this.status(provider) };
    await this.getStatus(provider);
    if (this.jobs.has(provider)) return { ...this.status(provider) };
    const status = this.status(provider);
    if (!status.canUpdate) throw new Error('Update this CLI using its original installer.');
    status.state = 'waiting';
    status.message = 'Waiting for active chats, jobs, and provider Shell sessions to finish.';
    const job = this.dependencies.coordinator.update(provider, async () => {
      status.state = 'updating';
      status.message = 'Updating CLI…';
      const installation = await this.dependencies.inspect(provider);
      if (!installation.canUpdate) throw new Error('The CLI installation changed. Check its installer.');
      await this.dependencies.install(provider, installation);
      const installed = await this.dependencies.inspect(provider);
      status.installedVersion = installed.version;
      await this.dependencies.verify(provider);
      status.updateAvailable = Boolean(status.latestVersion && isNewer(status.latestVersion, installed.version));
      status.state = status.updateAvailable ? 'error' : 'updated';
      this.completedAt.set(provider, this.dependencies.now());
      status.message = status.updateAvailable
        ? 'The updater finished, but the installed version has not advanced. Check the installation.'
        : `Updated to ${installed.version}.`;
    }).catch((error: unknown) => {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      status.state = cancelled ? 'idle' : 'error';
      status.message = cancelled ? null : error instanceof Error ? error.message : 'CLI update failed.';
    }).finally(() => this.jobs.delete(provider));
    this.jobs.set(provider, job);
    return { ...status };
  }

  async cancelUpdate(provider: UpdateProvider): Promise<ProviderCliUpdateStatus> {
    if (this.status(provider).state === 'waiting') {
      if (this.dependencies.coordinator.cancelWaiting(provider)) await this.jobs.get(provider);
    }
    return { ...this.status(provider) };
  }
}

/** Used by authenticated routes; checks never install updates. */
export const providerCliUpdatesService = new ProviderCliUpdatesService({
  inspect: inspectInstallation,
  latest: latestVersion,
  install: runNativeCliUpdate,
  verify: async (provider) => {
    if (provider === 'codex') await codexNativeRuntimeService.getActiveRuntime();
  },
  coordinator: providerUpdateCoordinator,
  now: Date.now,
});
