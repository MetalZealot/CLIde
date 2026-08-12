import os from 'node:os';
import path from 'node:path';

import { checkCodexAppServerCompatibility } from '@/modules/providers/list/codex/codex-app-server-compatibility.js';
import { getCodexChatTransportDiagnostics } from '@/modules/providers/list/codex/codex-chat-transport-state.js';
import { codexNativeRuntimeService } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';
import type { ProviderNativeRuntimeInstallation } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

export type CodexNativeRuntimeInstallationDto = {
  id: string;
  version: string;
  displayPath: string;
  sources: ProviderNativeRuntimeInstallation['sources'];
  bundled: boolean;
};

export type CodexNativeRuntimeStatusDto = {
  installations: CodexNativeRuntimeInstallationDto[];
  activeInstallationId: string | null;
  previousInstallationId: string | null;
  liveProcessInstallationId: string | null;
  sdkVersion: string | null;
  liveProcessVersion: string | null;
  updatePending: boolean;
  activeError: string | null;
};

export type CodexNativeRuntimeCheckDto = {
  installationId: string;
  compatibility: 'compatible' | 'incompatible' | 'check_failed';
  detail: string | null;
};

type NativeRuntimeService = Pick<
  typeof codexNativeRuntimeService,
  'getInstallation' | 'getRuntimeState' | 'selectInstallation'
>;

type ManagementDependencies = {
  runtimeService: NativeRuntimeService;
  checkCompatibility: typeof checkCodexAppServerCompatibility;
  getDiagnostics: typeof getCodexChatTransportDiagnostics;
  homeDirectory: string;
};

const displayRuntimePath = (realPath: string, homeDirectory: string): string => {
  const relative = path.relative(homeDirectory, realPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `~/${relative.split(path.sep).join('/')}`;
  }
  return realPath;
};

const installationDto = (
  installation: ProviderNativeRuntimeInstallation,
  homeDirectory: string,
): CodexNativeRuntimeInstallationDto => ({
  id: installation.id,
  version: installation.version,
  displayPath: displayRuntimePath(installation.realPath, homeDirectory),
  sources: [...installation.sources],
  bundled: installation.bundled,
});

export class CodexNativeRuntimeManagementService {
  private readonly dependencies: ManagementDependencies;

  constructor(dependencies: ManagementDependencies) {
    this.dependencies = dependencies;
  }

  async getStatus(refresh = true): Promise<CodexNativeRuntimeStatusDto> {
    const state = await this.dependencies.runtimeService.getRuntimeState(refresh);
    const diagnostics = this.dependencies.getDiagnostics();
    return {
      installations: state.installations.map((installation) => (
        installationDto(installation, this.dependencies.homeDirectory)
      )),
      activeInstallationId: state.active?.id ?? null,
      previousInstallationId: state.previous?.id ?? null,
      liveProcessInstallationId: diagnostics.nativeRuntime.liveProcessInstallationId,
      sdkVersion: diagnostics.sdkVersion,
      liveProcessVersion: diagnostics.nativeRuntime.liveProcessVersion,
      updatePending: diagnostics.nativeRuntime.updatePending,
      activeError: state.activeError,
    };
  }

  async checkInstallation(id: string): Promise<CodexNativeRuntimeCheckDto> {
    const installation = await this.requireInstallation(id);
    const result = await this.dependencies.checkCompatibility(
      installation.realPath,
      { detailed: true },
    );
    return { installationId: installation.id, ...result };
  }

  async selectInstallation(id: string): Promise<CodexNativeRuntimeStatusDto> {
    await this.requireInstallation(id);
    await this.dependencies.runtimeService.selectInstallation(id);
    return this.getStatus(false);
  }

  private async requireInstallation(id: string): Promise<ProviderNativeRuntimeInstallation> {
    const installation = await this.dependencies.runtimeService.getInstallation(id, true);
    if (!installation) {
      throw new AppError('Codex runtime installation was not found.', {
        code: 'CODEX_RUNTIME_NOT_FOUND',
        statusCode: 404,
      });
    }
    return installation;
  }
}

export const codexNativeRuntimeManagementService = new CodexNativeRuntimeManagementService({
  runtimeService: codexNativeRuntimeService,
  checkCompatibility: checkCodexAppServerCompatibility,
  getDiagnostics: getCodexChatTransportDiagnostics,
  homeDirectory: os.homedir(),
});
