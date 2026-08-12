import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createCodexNativeRuntimeRouter } from '@/modules/providers/codex-native-runtime.routes.js';
import { CodexNativeRuntimeManagementService } from '@/modules/providers/list/codex/codex-native-runtime-management.provider.js';
import type {
  ProviderNativeRuntimeInstallation,
  ProviderNativeRuntimeState,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const bundled: ProviderNativeRuntimeInstallation = {
  id: 'runtime_111111111111111111111111',
  provider: 'codex',
  realPath: '/home/test/app/node_modules/@openai/codex/vendor/codex',
  version: '0.147.0',
  fingerprint: 'bundled-fingerprint',
  sources: ['bundled'],
  bundled: true,
};

const candidate: ProviderNativeRuntimeInstallation = {
  id: 'runtime_222222222222222222222222',
  provider: 'codex',
  realPath: '/home/test/.local/lib/node_modules/@openai/codex/vendor/codex',
  version: '0.147.0',
  fingerprint: 'candidate-fingerprint',
  sources: ['path', 'known'],
  bundled: false,
};

const runtimeState = (): ProviderNativeRuntimeState => ({
  installations: [bundled, candidate],
  active: bundled,
  previous: null,
  activeError: null,
});

test('Codex runtime status distinguishes equal versions by display path and reports live state', async () => {
  const service = new CodexNativeRuntimeManagementService({
    runtimeService: {
      getRuntimeState: async () => runtimeState(),
      getInstallation: async (id) => [bundled, candidate].find((item) => item.id === id) ?? null,
      selectInstallation: async () => candidate,
    },
    checkCompatibility: (async () => 'compatible') as never,
    getDiagnostics: () => ({
      configured: 'app-server',
      actual: 'app-server',
      health: 'ready',
      sdkVersion: '0.147.0',
      bundledCliVersion: '0.147.0',
      lastError: null,
      lastStartupFallbackAt: null,
      nativeRuntime: {
        activeInstallationId: bundled.id,
        activeVersion: bundled.version,
        liveProcessInstallationId: bundled.id,
        liveProcessVersion: bundled.version,
        updatePending: false,
        facets: {},
      },
    }),
    homeDirectory: '/home/test',
  });

  const status = await service.getStatus();
  assert.deepEqual(status.installations.map(({ version, displayPath }) => ({ version, displayPath })), [
    { version: '0.147.0', displayPath: '~/app/node_modules/@openai/codex/vendor/codex' },
    { version: '0.147.0', displayPath: '~/.local/lib/node_modules/@openai/codex/vendor/codex' },
  ]);
  assert.equal(status.liveProcessInstallationId, bundled.id);
});

test('Codex runtime check returns the reused structural checker detail', async () => {
  const service = new CodexNativeRuntimeManagementService({
    runtimeService: {
      getRuntimeState: async () => runtimeState(),
      getInstallation: async () => candidate,
      selectInstallation: async () => candidate,
    },
    checkCompatibility: (async (_path: string, options?: { detailed: true }) => (
      options?.detailed
        ? { compatibility: 'incompatible', detail: 'ClientRequest.ts: method model/list' }
        : 'incompatible'
    )) as never,
    getDiagnostics: () => { throw new Error('Diagnostics should not be read'); },
    homeDirectory: '/home/test',
  });

  assert.deepEqual(await service.checkInstallation(candidate.id), {
    installationId: candidate.id,
    compatibility: 'incompatible',
    detail: 'ClientRequest.ts: method model/list',
  });
});

test('Codex runtime routes validate opaque ids and forward Check and Use', async () => {
  const calls: string[] = [];
  const router = createCodexNativeRuntimeRouter({
    getStatus: async () => ({ activeInstallationId: bundled.id }),
    checkInstallation: async (id: string) => {
      calls.push(`check:${id}`);
      return { installationId: id, compatibility: 'compatible', detail: null };
    },
    selectInstallation: async (id: string) => {
      calls.push(`select:${id}`);
      return { activeInstallationId: id };
    },
  } as never);
  const app = express();
  app.use(express.json());
  app.use('/api/providers/codex/runtime', router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('Unexpected error.');
    res.status(appError.statusCode).json({ error: appError.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/providers/codex/runtime`;
    const invalid = await fetch(`${baseUrl}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: candidate.realPath }),
    });
    assert.equal(invalid.status, 400);

    const checked = await fetch(`${baseUrl}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: candidate.id }),
    });
    assert.equal(checked.status, 200);
    const selected = await fetch(`${baseUrl}/selection`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: candidate.id }),
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(calls, [`check:${candidate.id}`, `select:${candidate.id}`]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
