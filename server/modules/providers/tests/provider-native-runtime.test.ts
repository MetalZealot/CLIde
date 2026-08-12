import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ProviderNativeRuntimeService } from '@/modules/providers/services/provider-native-runtime.service.js';
import type { ProviderNativeRuntimeDescriptor } from '@/shared/types.js';

const makeExecutable = async (filePath: string, version: string): Promise<void> => {
  await writeFile(filePath, version, { mode: 0o700 });
  await chmod(filePath, 0o700);
};

test('native runtime discovery seeds bundled, deduplicates symlinks, and persists promotion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-native-runtime-'));
  const storePath = path.join(root, 'state', 'provider-runtimes.json');
  const bundledPath = path.join(root, 'bundled-codex');
  const externalPath = path.join(root, 'external-codex');
  const linkedPath = path.join(root, 'linked-codex');
  await makeExecutable(bundledPath, '0.147.0');
  await makeExecutable(externalPath, '0.148.0');
  await symlink(externalPath, linkedPath);

  const descriptor: ProviderNativeRuntimeDescriptor = {
    provider: 'codex',
    executableName: 'not-on-path-clide-codex',
    configuredPathEnvVar: 'CLIDE_TEST_CODEX_PATH',
    resolveBundledExecutablePath: async () => bundledPath,
    readVersion: async (executablePath) => readFile(executablePath, 'utf8'),
    checkCompatibility: async () => 'compatible',
  };
  const service = new ProviderNativeRuntimeService(descriptor, {
    storePath,
    homeDirectory: root,
    env: { PATH: root, CLIDE_TEST_CODEX_PATH: linkedPath },
  });

  try {
    const installations = await service.listInstallations();
    assert.equal(installations.length, 2);
    const external = installations.find((installation) => installation.version === '0.148.0');
    assert.ok(external);
    assert.equal(external.realPath, externalPath);
    assert.deepEqual(external.sources, ['configured']);

    const seeded = await service.getActiveRuntime();
    assert.equal(seeded.bundled, true);
    assert.equal(seeded.version, '0.147.0');
    assert.equal((await lstat(storePath)).mode & 0o777, 0o600);

    const promoted = await service.selectInstallation(external.id);
    assert.equal(promoted.realPath, externalPath);
    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
      providers: { codex: { active: { realPath: string }; previous: { realPath: string } } };
    };
    assert.equal(persisted.providers.codex.active.realPath, externalPath);
    assert.equal(persisted.providers.codex.previous.realPath, bundledPath);

    const reloaded = new ProviderNativeRuntimeService(descriptor, {
      storePath,
      homeDirectory: root,
      env: { PATH: '' },
    });
    assert.equal((await reloaded.getActiveRuntime()).realPath, externalPath);

    await rm(externalPath);
    await assert.rejects(
      reloaded.getActiveRuntime(),
      /selected codex runtime is missing or changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native runtime selection rejects an incompatible discovered installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clide-native-runtime-'));
  const bundledPath = path.join(root, 'bundled-codex');
  const incompatiblePath = path.join(root, 'incompatible-codex');
  await makeExecutable(bundledPath, '0.147.0');
  await makeExecutable(incompatiblePath, '9.0.0');
  const descriptor: ProviderNativeRuntimeDescriptor = {
    provider: 'codex',
    executableName: 'not-on-path-clide-codex',
    configuredPathEnvVar: 'CLIDE_TEST_CODEX_PATH',
    resolveBundledExecutablePath: async () => bundledPath,
    readVersion: async (executablePath) => readFile(executablePath, 'utf8'),
    checkCompatibility: async (executablePath) => (
      executablePath === incompatiblePath ? 'incompatible' : 'compatible'
    ),
  };
  const service = new ProviderNativeRuntimeService(descriptor, {
    storePath: path.join(root, 'provider-runtimes.json'),
    homeDirectory: root,
    env: { PATH: '', CLIDE_TEST_CODEX_PATH: incompatiblePath },
  });

  try {
    const incompatible = (await service.listInstallations())
      .find((installation) => installation.realPath === incompatiblePath);
    assert.ok(incompatible);
    await assert.rejects(
      service.selectInstallation(incompatible.id),
      /compatibility incompatible/,
    );
    assert.equal((await service.getActiveRuntime()).bundled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
