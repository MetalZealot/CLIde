import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { checkCodexAppServerCompatibility } from '@/modules/providers/list/codex/codex-app-server-compatibility.js';
import {
  markCodexRuntimeFacetResolved,
  markCodexRuntimeSelection,
} from '@/modules/providers/list/codex/codex-chat-transport-state.js';
import {
  buildProviderNativeRuntimeCommand,
  ProviderNativeRuntimeService,
  runProviderNativeRuntimeCommand,
} from '@/modules/providers/services/provider-native-runtime.service.js';
import type {
  CodexNativeRuntimeFacet,
  ProviderNativeRuntimeCommand,
  ProviderNativeRuntimeDescriptor,
  ProviderNativeRuntimeInstallation,
} from '@/shared/types.js';

const moduleRequire = createRequire(import.meta.url);

const PLATFORM_TARGETS: Partial<Record<NodeJS.Platform, Partial<Record<string, {
  packageName: string;
  triple: string;
}>>>> = {
  linux: {
    x64: { packageName: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl' },
    arm64: { packageName: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' },
  },
  android: {
    x64: { packageName: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl' },
    arm64: { packageName: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' },
  },
  darwin: {
    x64: { packageName: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin' },
    arm64: { packageName: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin' },
  },
  win32: {
    x64: { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' },
    arm64: { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' },
  },
};

const resolveBundledCodexExecutablePath = async (): Promise<string> => {
  const target = PLATFORM_TARGETS[process.platform]?.[process.arch];
  if (!target) {
    throw new Error(`Unsupported Codex platform: ${process.platform} (${process.arch}).`);
  }
  const codexManifestPath = moduleRequire.resolve('@openai/codex/package.json');
  const codexRequire = createRequire(codexManifestPath);
  const platformManifestPath = codexRequire.resolve(`${target.packageName}/package.json`);
  const vendorRoot = path.join(path.dirname(platformManifestPath), 'vendor', target.triple);
  const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  return path.join(vendorRoot, 'bin', executableName);
};

const readCodexVersion = async (executablePath: string): Promise<string | null> => {
  try {
    const output = await runProviderNativeRuntimeCommand(executablePath, ['--version']);
    return output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null;
  } catch {
    return null;
  }
};

const codexRuntimeDescriptor: ProviderNativeRuntimeDescriptor = {
  provider: 'codex',
  executableName: 'codex',
  configuredPathEnvVar: 'CLIDE_CODEX_CLI_PATH',
  resolveBundledExecutablePath: resolveBundledCodexExecutablePath,
  readVersion: readCodexVersion,
  checkCompatibility: checkCodexAppServerCompatibility,
};

/**
 * Codex facets and the Phase 6 runtime routes share this singleton so one
 * persisted selection controls every process launch and change notification.
 */
export const codexNativeRuntimeService = new ProviderNativeRuntimeService(
  codexRuntimeDescriptor,
  { storePath: path.join(os.homedir(), '.cloudcli', 'provider-runtimes.json') },
);

codexNativeRuntimeService.onSelectionChanged(markCodexRuntimeSelection);

/** Records a Codex facet's approved runtime without exposing its filesystem path. */
export async function resolveSelectedCodexRuntime(
  facet: CodexNativeRuntimeFacet,
): Promise<ProviderNativeRuntimeInstallation> {
  const runtime = await codexNativeRuntimeService.getActiveRuntime();
  markCodexRuntimeFacetResolved(facet, runtime);
  return runtime;
}

/** Builds a shell-free command for App Server readers and Chat. */
export async function resolveSelectedCodexRuntimeCommand(
  facet: CodexNativeRuntimeFacet,
  args: string[],
): Promise<{ command: ProviderNativeRuntimeCommand; runtime: ProviderNativeRuntimeInstallation }> {
  const runtime = await resolveSelectedCodexRuntime(facet);
  return {
    command: buildProviderNativeRuntimeCommand(runtime.realPath, args),
    runtime,
  };
}

const quotePosixArgument = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
const quotePowerShellArgument = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const renderShellInvocation = (
  command: ProviderNativeRuntimeCommand,
  args: string[],
): string => {
  const values = [command.command, ...command.args, ...args];
  if (process.platform === 'win32') {
    return `& ${values.map(quotePowerShellArgument).join(' ')}`;
  }
  return values.map(quotePosixArgument).join(' ');
};

/** The Shell websocket uses this platform-quoted command for selected Codex. */
export async function buildSelectedCodexShellCommand(
  resumeSessionId?: string,
): Promise<string> {
  const runtime = await resolveSelectedCodexRuntime('shell');
  const command = buildProviderNativeRuntimeCommand(runtime.realPath);
  const fresh = renderShellInvocation(command, []);
  if (!resumeSessionId) {
    return fresh;
  }
  const resumed = renderShellInvocation(command, ['resume', resumeSessionId]);
  return process.platform === 'win32'
    ? `${resumed}; if ($LASTEXITCODE -ne 0) { ${fresh} }`
    : `${resumed} || ${fresh}`;
}
