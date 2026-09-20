import fs from 'node:fs';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

import { sessionsService } from '../services/sessions.service.js';
import { transcriptRow, type HistoryProfile, type HistoryProvider } from '../../../../scripts/chat-history/fixtures.js';

/** Provider tests and the benchmark use only this task-owned database and files. */
export async function createHistoryFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clide-history-fixture-'));
  const previousDatabase = process.env.DATABASE_PATH;
  closeConnection();
  // Create the empty target before getConnection can consider legacy migration.
  const database = path.join(directory, 'auth.db');
  await writeFile(database, '');
  process.env.DATABASE_PATH = database;
  const originalStream = fs.createReadStream;
  let bytesRead = 0;
  let streamReads = 0;
  fs.createReadStream = ((file, options) => {
    const resolved = path.resolve(String(file));
    if (!resolved.endsWith('.jsonl')) return originalStream(file, options);
    if (!resolved.startsWith(directory + path.sep)) throw new Error('Fixture attempted an out-of-fixture stream read');
    streamReads++;
    const stream = originalStream(file, options);
    stream.on('data', (chunk) => { bytesRead += Buffer.byteLength(chunk); });
    return stream;
  }) as typeof fs.createReadStream;
  const records = new Map<string, { file: string; provider: HistoryProvider; nativeId: string; count: number; profile: HistoryProfile }>();
  const close = async () => {
    fs.createReadStream = originalStream;
    closeConnection();
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    await rm(directory, { recursive: true, force: true });
  };
  try { await initializeDatabase(); } catch (error) { await close(); throw error; }
  return {
    directory,
    async add(provider: HistoryProvider, count: number, profile: HistoryProfile = 'plain') {
      const nativeId = `native-${provider}-${count}-${profile}-${records.size}`;
      const appId = `app-${nativeId}`;
      const file = path.join(directory, `${nativeId}.jsonl`);
      const rows = Array.from({ length: count }, (_, i) => transcriptRow(provider, nativeId, i, profile));
      const lines = rows.flatMap((row, i) => provider === 'codex' && i % 2 === 0
        ? [JSON.stringify({ type: 'turn_context', payload: { turn_id: `turn-${i}` } }), JSON.stringify(row)]
        : [JSON.stringify(row)]);
      await writeFile(file, lines.join('\n') + '\n');
      sessionsDb.createAppSession(appId, provider, directory);
      sessionsDb.assignProviderSessionId(appId, nativeId);
      // Discovery fills in the path while retaining the app-owned id.
      sessionsDb.createSession(nativeId, provider, directory, 'Synthetic benchmark', undefined, undefined, file);
      records.set(appId, { file, provider, nativeId, count, profile });
      return appId;
    },
    async append(id: string) {
      const r = records.get(id)!;
      const context = r.provider === 'codex' && r.count % 2 === 0
        ? JSON.stringify({ type: 'turn_context', payload: { turn_id: `turn-${r.count}` } }) + '\n' : '';
      await appendFile(r.file, context + JSON.stringify(transcriptRow(r.provider, r.nativeId, r.count++, r.profile)) + '\n');
    },
    async branch(id: string, parentIndex: number) {
      const r = records.get(id)!;
      if (r.provider !== 'claude') throw new Error('Branch fixture requires Claude');
      const row = { ...transcriptRow(r.provider, r.nativeId, r.count++, 'plain'), parentUuid: `row-${parentIndex}` };
      await appendFile(r.file, JSON.stringify(row) + '\n');
    },
    async subagent(id: string, output: string) {
      const r = records.get(id)!;
      if (r.provider !== 'claude') throw new Error('Subagent fixture requires Claude');
      const subdir = path.join(r.file.replace(/\.jsonl$/, ''), 'subagents');
      await mkdir(subdir, { recursive: true });
      await writeFile(path.join(subdir, 'agent-fixture.jsonl'), [
        { uuid: 'child-1', sessionId: r.nativeId, isSidechain: true, timestamp: '2024-01-01T00:00:00Z', type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'child-tool', name: 'Bash', input: { command: 'echo fixture' } }] } },
        { uuid: 'child-2', sessionId: r.nativeId, isSidechain: true, timestamp: '2024-01-01T00:00:01Z', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'child-tool', content: output }] } },
      ].map((row) => JSON.stringify(row)).join('\n') + '\n');
    },
    read: (id: string, limit: number | null = 20, offset = 0) => sessionsService.fetchHistory(id, { limit, offset }),
    resetReads: () => { bytesRead = 0; streamReads = 0; },
    reads: () => ({ bytesRead, streamReads }),
    close,
  };
}
