import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkCodexAppServerCompatibility } from '@/modules/providers/list/codex/codex-app-server-compatibility.js';

const moduleRequire = createRequire(import.meta.url);
const EXPECTED_CODEX_VERSION = '0.147.0';

test(`Codex SDK and bundled CLI stay pinned to ${EXPECTED_CODEX_VERSION}`, () => {
  const codexBin = moduleRequire.resolve('@openai/codex/bin/codex.js');
  const sdk = JSON.parse(readFileSync(
    path.resolve(codexBin, '../../../codex-sdk/package.json'),
    'utf8',
  )) as { version: string };
  const cli = JSON.parse(readFileSync(
    path.resolve(codexBin, '../../package.json'),
    'utf8',
  )) as { version: string };
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
