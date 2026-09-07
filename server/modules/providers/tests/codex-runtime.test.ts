import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createCodexNativeRuntimeRouter } from '@/modules/providers/codex-native-runtime.routes.js';
import { checkCodexAppServerCompatibility } from '@/modules/providers/list/codex/codex-app-server-compatibility.js';
import { CodexNativeRuntimeManagementService } from '@/modules/providers/list/codex/codex-native-runtime-management.provider.js';
import { JsonlRpcClient, JsonlRpcError } from '@/modules/providers/shared/jsonl-rpc.client.js';
import type { ProviderNativeRuntimeInstallation, ProviderNativeRuntimeState } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

describe('codex-app-server-protocol-drift', () => {
  const moduleRequire = createRequire(import.meta.url);
  const EXPECTED_CODEX_VERSION = '0.153.4';

  test(`Codex source, lockfile, SDK, and bundled CLI stay pinned to ${EXPECTED_CODEX_VERSION}`, () => {
    const manifest = JSON.parse(readFileSync(
      path.resolve('package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> };
    const lockfile = JSON.parse(readFileSync(
      path.resolve('package-lock.json'),
      'utf8',
    )) as {
      packages?: Record<string, {
        dependencies?: Record<string, string>;
        version?: string;
      }>;
    };
    const codexBin = moduleRequire.resolve('@openai/codex/bin/codex.js');
    const sdk = JSON.parse(readFileSync(
      path.resolve(codexBin, '../../../codex-sdk/package.json'),
      'utf8',
    )) as { version: string };
    const cli = JSON.parse(readFileSync(
      path.resolve(codexBin, '../../package.json'),
      'utf8',
    )) as { version: string };

    assert.equal(manifest.dependencies?.['@openai/codex-sdk'], EXPECTED_CODEX_VERSION);
    assert.equal(lockfile.packages?.['']?.dependencies?.['@openai/codex-sdk'], EXPECTED_CODEX_VERSION);
    assert.equal(lockfile.packages?.['node_modules/@openai/codex-sdk']?.version, EXPECTED_CODEX_VERSION);
    assert.equal(lockfile.packages?.['node_modules/@openai/codex']?.version, EXPECTED_CODEX_VERSION);
    assert.equal(sdk.version, EXPECTED_CODEX_VERSION);
    assert.equal(cli.version, EXPECTED_CODEX_VERSION);
  });

  test(`generated ${EXPECTED_CODEX_VERSION} protocol retains CLIde Chat methods and fields`, async () => {
    const result = await checkCodexAppServerCompatibility(
      moduleRequire.resolve('@openai/codex/bin/codex.js'),
    );
    assert.equal(result, 'compatible');
  });

  test('Codex compatibility checker distinguishes incompatible protocols from failed checks', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clide-codex-checker-'));
    try {
      const emptyGenerator = path.join(tempRoot, 'empty-generator.mjs');
      await writeFile(emptyGenerator, '', 'utf8');

      assert.equal(
        await checkCodexAppServerCompatibility(emptyGenerator),
        'incompatible',
      );
      assert.deepEqual(
        await checkCodexAppServerCompatibility(emptyGenerator, { detailed: true }),
        {
          compatibility: 'incompatible',
          detail: 'ClientRequest.ts: method initialize',
        },
      );
      assert.equal(
        await checkCodexAppServerCompatibility(path.join(tempRoot, 'missing-codex')),
        'check_failed',
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('codex-native-runtime-management', () => {
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
});

describe('jsonl-rpc-client', () => {
  async function withFakeServer(
    source: string,
    run: (scriptPath: string) => Promise<void>,
  ): Promise<void> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clide-jsonl-rpc-'));
    const scriptPath = path.join(tempRoot, 'fake-server.mjs');
    try {
      await writeFile(scriptPath, source, 'utf8');
      await run(scriptPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  test('JSONL RPC correlates interleaved responses, notifications, and server requests', async () => {
    await withFakeServer(
      `import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const requests = [];
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'one' || message.method === 'two') {
      requests.push(message);
      if (requests.length === 2) {
        process.stdout.write(JSON.stringify({ method: 'notice', params: { value: 7 } }) + '\\n');
        process.stdout.write(JSON.stringify({ id: 'server-1', method: 'approve', params: { ok: true } }) + '\\n');
        process.stdout.write(JSON.stringify({ id: requests[1].id, result: 'second' }) + '\\n');
        process.stdout.write(JSON.stringify({ id: requests[0].id, result: 'first' }) + '\\n');
      }
    } else if (message.id === 'server-1' && message.result) {
      process.exit(message.result.accepted ? 0 : 2);
    }
  }`,
      async (scriptPath) => {
        const notifications: unknown[] = [];
        const serverRequests: unknown[] = [];
        const client = new JsonlRpcClient({
          command: { command: process.execPath, args: [scriptPath] },
          onNotification: (method, params) => {
            notifications.push({ method, params });
          },
          onServerRequest: ({ id, method, params }) => {
            serverRequests.push({ id, method, params });
            client.respond(id, { accepted: true });
          },
        });
        client.open();

        const [first, second] = await Promise.all([
          client.request('one', null),
          client.request('two', null),
        ]);
        assert.equal(first, 'first');
        assert.equal(second, 'second');
        assert.deepEqual(notifications, [{ method: 'notice', params: { value: 7 } }]);
        assert.deepEqual(serverRequests, [{
          id: 'server-1',
          method: 'approve',
          params: { ok: true },
        }]);
        client.close();
      },
    );
  });

  test('JSONL RPC rejects RPC errors with code and data', async () => {
    await withFakeServer(
      `import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const message = JSON.parse(line);
    process.stdout.write(JSON.stringify({
      id: message.id,
      error: { code: 41, message: 'rejected', data: { reason: 'test' } }
    }) + '\\n');
  }`,
      async (scriptPath) => {
        const client = new JsonlRpcClient({
          command: { command: process.execPath, args: [scriptPath] },
        });
        client.open();
        await assert.rejects(
          client.request('fail', null),
          (error: unknown) =>
            error instanceof JsonlRpcError
            && error.code === 41
            && error.message === 'rejected'
            && assert.deepEqual(error.data, { reason: 'test' }) === undefined,
        );
        client.close();
      },
    );
  });

  test('JSONL RPC fails pending work on malformed frames and process exit', async () => {
    await withFakeServer(
      `import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const _line of lines) {
    process.stdout.write('{not json}\\n');
  }`,
      async (scriptPath) => {
        let exitError: Error | null = null;
        const client = new JsonlRpcClient({
          command: { command: process.execPath, args: [scriptPath] },
          onExit: (error) => {
            exitError = error;
          },
        });
        client.open();
        await assert.rejects(client.request('malformed', null), /invalid frame/);
        assert.ok(exitError);
        assert.match((exitError as Error).message, /invalid frame/);
        assert.equal(client.isOpen, false);
      },
    );

    await withFakeServer(
      `import readline from 'node:readline';
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const _line of lines) process.exit(9);
  `,
      async (scriptPath) => {
        const client = new JsonlRpcClient({
          command: { command: process.execPath, args: [scriptPath] },
        });
        client.open();
        await assert.rejects(client.request('exit', null), /code 9/);
      },
    );
  });
});
