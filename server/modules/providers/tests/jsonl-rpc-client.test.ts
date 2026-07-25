import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  JsonlRpcClient,
  JsonlRpcError,
} from '@/modules/providers/shared/jsonl-rpc.client.js';

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
