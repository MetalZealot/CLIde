import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ProviderNativeRuntimeCommand,
  ProviderNativeRuntimeCompatibility,
  ProviderNativeRuntimeDescriptor,
  ProviderNativeRuntimeInstallation,
  ProviderNativeRuntimeState,
  ProviderNativeRuntimeSource,
} from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type PersistedRuntimeFingerprint = {
  realPath: string;
  fingerprint: string;
};

type PersistedProviderSelection = {
  active: PersistedRuntimeFingerprint;
  previous: PersistedRuntimeFingerprint | null;
};

type ProviderRuntimeStore = {
  version: 1;
  providers: Record<string, unknown>;
};

type RuntimeSnapshot = {
  installations: ProviderNativeRuntimeInstallation[];
  selection: PersistedProviderSelection;
  active: ProviderNativeRuntimeInstallation | null;
  activeError: string | null;
};

type ProviderNativeRuntimeServiceOptions = {
  storePath?: string;
  homeDirectory?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

type CandidatePath = {
  candidatePath: string;
  source: ProviderNativeRuntimeSource;
};

const STORE_VERSION = 1;
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const storeMutationQueues = new Map<string, Promise<void>>();

const isJavaScriptLauncher = (executablePath: string): boolean => (
  ['.js', '.cjs', '.mjs'].includes(path.extname(executablePath).toLowerCase())
);

const quoteCmdArgument = (value: string): string => (
  `"${value.replace(/(["^&|<>()])/g, '^$1').replace(/%/g, '%%')}"`
);

/**
 * Provider descriptors and process-owning adapters use this to launch native
 * binaries and JavaScript/npm shims without invoking a shell.
 */
export function buildProviderNativeRuntimeCommand(
  executablePath: string,
  args: string[] = [],
  platform: NodeJS.Platform = process.platform,
): ProviderNativeRuntimeCommand {
  if (isJavaScriptLauncher(executablePath)) {
    return { command: process.execPath, args: [executablePath, ...args] };
  }

  const extension = path.extname(executablePath).toLowerCase();
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    const commandLine = [executablePath, ...args].map(quoteCmdArgument).join(' ');
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
    };
  }

  return { command: executablePath, args };
}

/**
 * Provider descriptors use this bounded subprocess helper for version reads;
 * callers receive stdout only after a successful exit.
 */
export async function runProviderNativeRuntimeCommand(
  executablePath: string,
  args: string[],
): Promise<string> {
  const command = buildProviderNativeRuntimeCommand(executablePath, args);
  return new Promise<string>((resolve, reject) => {
    execFile(command.command, command.args, {
      env: process.env,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

const readPersistedFingerprint = (value: unknown): PersistedRuntimeFingerprint | null => {
  const record = readObjectRecord(value);
  const realPathValue = readOptionalString(record?.realPath);
  const fingerprint = readOptionalString(record?.fingerprint);
  return realPathValue && fingerprint ? { realPath: realPathValue, fingerprint } : null;
};

const readPersistedSelection = (value: unknown): PersistedProviderSelection | null => {
  const record = readObjectRecord(value);
  const active = readPersistedFingerprint(record?.active);
  if (!active) {
    return null;
  }
  return {
    active,
    previous: readPersistedFingerprint(record?.previous),
  };
};

const readRuntimeStore = async (storePath: string): Promise<ProviderRuntimeStore> => {
  try {
    const parsed = readObjectRecord(JSON.parse(await readFile(storePath, 'utf8')));
    const providers = readObjectRecord(parsed?.providers);
    if (parsed?.version !== STORE_VERSION || !providers) {
      throw new Error('Provider runtime selection store has an unsupported shape.');
    }
    return { version: STORE_VERSION, providers };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: STORE_VERSION, providers: {} };
    }
    throw error;
  }
};

const writeRuntimeStore = async (
  storePath: string,
  store: ProviderRuntimeStore,
): Promise<void> => {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, storePath);
    await chmod(storePath, 0o600);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const mutateRuntimeStore = async (
  storePath: string,
  mutate: (store: ProviderRuntimeStore) => void,
): Promise<void> => {
  const previous = storeMutationQueues.get(storePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const store = await readRuntimeStore(storePath);
    mutate(store);
    await writeRuntimeStore(storePath, store);
  });
  storeMutationQueues.set(storePath, current);
  try {
    await current;
  } finally {
    if (storeMutationQueues.get(storePath) === current) {
      storeMutationQueues.delete(storePath);
    }
  }
};

const executableNames = (
  executableName: string,
  platform: NodeJS.Platform,
): string[] => platform === 'win32'
  ? [`${executableName}.exe`, `${executableName}.cmd`, `${executableName}.bat`, executableName]
  : [executableName];

const pathsInDirectory = (
  directory: string,
  executableName: string,
  platform: NodeJS.Platform,
  source: ProviderNativeRuntimeSource,
): CandidatePath[] => executableNames(executableName, platform).map((name) => ({
  candidatePath: path.join(directory, name),
  source,
}));

const knownInstallerDirectories = async (
  homeDirectory: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string[]> => {
  const directories = [
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.npm-global', 'bin'),
    path.join(homeDirectory, '.bun', 'bin'),
    path.join(homeDirectory, '.volta', 'bin'),
  ];

  if (platform === 'win32') {
    if (env.APPDATA) directories.push(path.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) directories.push(path.join(env.LOCALAPPDATA, 'Programs'));
  } else {
    directories.push('/usr/local/bin', '/opt/homebrew/bin');
  }

  const nvmVersionsPath = path.join(homeDirectory, '.nvm', 'versions', 'node');
  try {
    const versions = await readdir(nvmVersionsPath, { withFileTypes: true });
    directories.push(...versions
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(nvmVersionsPath, entry.name, 'bin')));
  } catch {
    // NVM is optional.
  }

  return directories;
};

const fingerprintInstallation = (
  provider: string,
  realPathValue: string,
  version: string,
  file: Awaited<ReturnType<typeof stat>>,
): string => createHash('sha256')
  .update([
    provider,
    realPathValue,
    version,
    String(file.dev),
    String(file.ino),
    String(file.size),
    String(file.mtimeMs),
    String(file.ctimeMs),
  ].join('\0'))
  .digest('hex');

const installationId = (provider: string, fingerprint: string): string => (
  `runtime_${createHash('sha256').update(`${provider}\0${fingerprint}`).digest('hex').slice(0, 24)}`
);

/**
 * Provider adapters instantiate this shared resolver to discover executables,
 * persist one approved fingerprint, and reject missing or changed selections
 * without silently falling back to another candidate.
 */
export class ProviderNativeRuntimeService {
  private readonly descriptor: ProviderNativeRuntimeDescriptor;
  private readonly storePath: string;
  private readonly homeDirectory: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private snapshot: RuntimeSnapshot | null = null;
  private loading: Promise<RuntimeSnapshot> | null = null;
  private readonly compatibilityByFingerprint = new Map<string, ProviderNativeRuntimeCompatibility>();
  private readonly selectionListeners = new Set<(
    runtime: ProviderNativeRuntimeInstallation,
  ) => void>();

  constructor(
    descriptor: ProviderNativeRuntimeDescriptor,
    options: ProviderNativeRuntimeServiceOptions = {},
  ) {
    this.descriptor = descriptor;
    this.homeDirectory = options.homeDirectory ?? os.homedir();
    this.storePath = options.storePath
      ?? path.join(this.homeDirectory, '.cloudcli', 'provider-runtimes.json');
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
  }

  async listInstallations(refresh = false): Promise<ProviderNativeRuntimeInstallation[]> {
    return [...(await this.loadSnapshot(refresh)).installations];
  }

  async getRuntimeState(refresh = false): Promise<ProviderNativeRuntimeState> {
    const snapshot = await this.loadSnapshot(refresh);
    const previous = snapshot.selection.previous
      ? snapshot.installations.find((installation) => (
        installation.realPath === snapshot.selection.previous?.realPath
        && installation.fingerprint === snapshot.selection.previous.fingerprint
      )) ?? null
      : null;
    return {
      installations: [...snapshot.installations],
      active: snapshot.active,
      previous,
      activeError: snapshot.activeError,
    };
  }

  async getInstallation(
    id: string,
    refresh = false,
  ): Promise<ProviderNativeRuntimeInstallation | null> {
    const snapshot = await this.loadSnapshot(refresh);
    return snapshot.installations.find((installation) => installation.id === id) ?? null;
  }

  async getActiveRuntime(): Promise<ProviderNativeRuntimeInstallation> {
    const snapshot = await this.loadSnapshot(false);
    if (!snapshot.active) {
      throw new Error(snapshot.activeError ?? `No ${this.descriptor.provider} runtime is selected.`);
    }

    const current = await this.probeCandidate({
      candidatePath: snapshot.active.realPath,
      source: 'persisted',
    }, snapshot.active.realPath);
    if (!current || current.fingerprint !== snapshot.selection.active.fingerprint) {
      throw new Error(
        `The selected ${this.descriptor.provider} runtime is missing or changed; promote it again before use.`,
      );
    }

    return snapshot.active;
  }

  async selectInstallation(id: string): Promise<ProviderNativeRuntimeInstallation> {
    const snapshot = await this.loadSnapshot(true);
    const selected = snapshot.installations.find((installation) => installation.id === id);
    if (!selected) {
      throw new Error(`Unknown ${this.descriptor.provider} runtime installation.`);
    }
    const compatibility = await this.readCompatibility(selected);
    if (compatibility !== 'compatible') {
      throw new Error(
        `${this.descriptor.provider} runtime cannot be selected: compatibility ${compatibility}.`,
      );
    }

    if (
      snapshot.selection.active.realPath === selected.realPath
      && snapshot.selection.active.fingerprint === selected.fingerprint
    ) {
      return selected;
    }

    const nextSelection: PersistedProviderSelection = {
      active: { realPath: selected.realPath, fingerprint: selected.fingerprint },
      previous: snapshot.selection.active,
    };
    await this.persistSelection(nextSelection);
    this.snapshot = {
      ...snapshot,
      selection: nextSelection,
      active: selected,
      activeError: null,
    };
    for (const listener of this.selectionListeners) {
      listener(selected);
    }
    return selected;
  }

  onSelectionChanged(
    listener: (runtime: ProviderNativeRuntimeInstallation) => void,
  ): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  private async loadSnapshot(refresh: boolean): Promise<RuntimeSnapshot> {
    if (this.snapshot && !refresh) {
      return this.snapshot;
    }
    if (this.loading) {
      return this.loading;
    }
    this.loading = this.discoverSnapshot().finally(() => {
      this.loading = null;
    });
    this.snapshot = await this.loading;
    return this.snapshot;
  }

  private async discoverSnapshot(): Promise<RuntimeSnapshot> {
    const store = await readRuntimeStore(this.storePath);
    let selection = readPersistedSelection(store.providers[this.descriptor.provider]);
    const bundledPath = await this.descriptor.resolveBundledExecutablePath();
    const pathEntries = (this.env.PATH ?? this.env.Path ?? this.env.path ?? '')
      .split(path.delimiter)
      .filter(Boolean);
    const knownDirectories = await knownInstallerDirectories(
      this.homeDirectory,
      this.env,
      this.platform,
    );
    const candidatePaths: CandidatePath[] = [
      ...(this.env[this.descriptor.configuredPathEnvVar]
        ? [{
            candidatePath: this.env[this.descriptor.configuredPathEnvVar] as string,
            source: 'configured' as const,
          }]
        : []),
      ...pathEntries.flatMap((directory) => pathsInDirectory(
        directory,
        this.descriptor.executableName,
        this.platform,
        'path',
      )),
      ...knownDirectories.flatMap((directory) => pathsInDirectory(
        directory,
        this.descriptor.executableName,
        this.platform,
        'known',
      )),
      ...(selection
        ? [selection.active, selection.previous]
          .filter((entry): entry is PersistedRuntimeFingerprint => entry !== null)
          .map((entry) => ({ candidatePath: entry.realPath, source: 'persisted' as const }))
        : []),
      { candidatePath: bundledPath, source: 'bundled' },
    ];

    let bundledRealPath: string;
    try {
      bundledRealPath = await realpath(bundledPath);
    } catch {
      throw new Error(`Bundled ${this.descriptor.provider} runtime is unavailable.`);
    }

    const installationsByPath = new Map<string, ProviderNativeRuntimeInstallation>();
    for (const candidate of candidatePaths) {
      const installation = await this.probeCandidate(candidate, bundledRealPath);
      if (!installation) {
        continue;
      }
      const existing = installationsByPath.get(installation.realPath);
      if (existing) {
        if (!existing.sources.includes(candidate.source)) {
          existing.sources.push(candidate.source);
        }
        existing.bundled ||= installation.bundled;
      } else {
        installationsByPath.set(installation.realPath, installation);
      }
    }
    const installations = [...installationsByPath.values()];
    const bundled = installations.find((installation) => installation.bundled);
    if (!bundled) {
      throw new Error(`Bundled ${this.descriptor.provider} runtime is unavailable.`);
    }

    if (!selection) {
      const compatibility = await this.readCompatibility(bundled);
      if (compatibility !== 'compatible') {
        throw new Error(
          `Bundled ${this.descriptor.provider} runtime compatibility ${compatibility}.`,
        );
      }
      selection = {
        active: { realPath: bundled.realPath, fingerprint: bundled.fingerprint },
        previous: null,
      };
      await this.persistSelection(selection);
    }

    const active = installations.find((installation) => (
      installation.realPath === selection.active.realPath
      && installation.fingerprint === selection.active.fingerprint
    )) ?? null;
    let activeError: string | null = null;
    if (!active) {
      activeError = `The selected ${this.descriptor.provider} runtime is missing or changed; promote it again before use.`;
    } else {
      const compatibility = await this.readCompatibility(active);
      if (compatibility !== 'compatible') {
        activeError = `The selected ${this.descriptor.provider} runtime compatibility is ${compatibility}.`;
      }
    }

    return {
      installations,
      selection,
      active: activeError ? null : active,
      activeError,
    };
  }

  private async probeCandidate(
    candidate: CandidatePath,
    bundledRealPath: string,
  ): Promise<ProviderNativeRuntimeInstallation | null> {
    try {
      const resolvedPath = await realpath(path.resolve(candidate.candidatePath));
      const file = await stat(resolvedPath);
      if (!file.isFile()) {
        return null;
      }
      const version = await this.descriptor.readVersion(resolvedPath);
      if (!version) {
        return null;
      }
      const fingerprint = fingerprintInstallation(
        this.descriptor.provider,
        resolvedPath,
        version,
        file,
      );
      return {
        id: installationId(this.descriptor.provider, fingerprint),
        provider: this.descriptor.provider,
        realPath: resolvedPath,
        version,
        fingerprint,
        sources: [candidate.source],
        bundled: resolvedPath === bundledRealPath,
      };
    } catch {
      return null;
    }
  }

  private async readCompatibility(
    installation: ProviderNativeRuntimeInstallation,
  ): Promise<ProviderNativeRuntimeCompatibility> {
    const cached = this.compatibilityByFingerprint.get(installation.fingerprint);
    if (cached) {
      return cached;
    }
    const compatibility = await this.descriptor.checkCompatibility(installation.realPath);
    this.compatibilityByFingerprint.set(installation.fingerprint, compatibility);
    return compatibility;
  }

  private async persistSelection(selection: PersistedProviderSelection): Promise<void> {
    await mutateRuntimeStore(this.storePath, (store) => {
      store.providers[this.descriptor.provider] = selection;
    });
  }
}
