import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';

test('Codex auth reports the selected runtime as installed', async () => {
  let runtimeReads = 0;
  const provider = new CodexProviderAuth({
    resolveRuntime: async () => { runtimeReads += 1; },
    readCredentials: async () => ({
      authenticated: true,
      email: 'codex@example.test',
      method: 'credentials_file',
    }),
  });

  assert.deepEqual(await provider.getStatus(), {
    installed: true,
    provider: 'codex',
    authenticated: true,
    email: 'codex@example.test',
    method: 'credentials_file',
    error: undefined,
  });
  assert.equal(runtimeReads, 1);
});

test('Codex auth does not substitute a PATH binary when the selection is invalid', async () => {
  const provider = new CodexProviderAuth({
    resolveRuntime: async () => { throw new Error('selection changed'); },
    readCredentials: async () => ({ authenticated: false, email: null, method: null }),
  });

  assert.equal((await provider.getStatus()).installed, false);
});
