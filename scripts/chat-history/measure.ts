import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createHistoryFixture } from '../../server/modules/providers/tests/chat-history.fixture.js';
import { HISTORY_FIXTURE_VERSION, HISTORY_SIZES } from './fixtures.js';
import { historyBudgets } from './budgets.js';
import { historySourceState } from './source-state.js';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const samples = Number(arg('samples') ?? 5);
if (!Number.isInteger(samples) || samples < 3 || samples > 30) throw new Error('samples must be 3..30');
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summarize = (values: number[]) => ({ median: +percentile(values, 0.5).toFixed(2), p95: +percentile(values, 0.95).toFixed(2) });
const fixture = await createHistoryFixture();
const ids = new Set<string>();
// An isolated transport around the real sessions service; production auth is not benchmarked.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const id = url.pathname.slice(1);
    if (req.method !== 'GET' || !ids.has(id)) { res.writeHead(404).end(); return; }
    const result = await fixture.read(id, 20, Number(url.searchParams.get('offset') ?? 0));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, data: result }));
  } catch { res.writeHead(500).end('Fixture read failed'); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No fixture listener');
const results: object[] = [];
const source = historySourceState();
let structuralFailures = 0;
try {
  for (const provider of ['claude', 'codex'] as const) {
    for (const size of HISTORY_SIZES) {
      const cold: number[] = [], warm: number[] = [], http: number[] = [], httpCold: number[] = [];
      const readBytes: number[] = [], bodyBytes: number[] = [], heap: number[] = [];
      for (let sample = 0; sample < samples; sample++) {
        const id = await fixture.add(provider, size);
        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        let start = performance.now();
        const first = await fixture.read(id);
        cold.push(performance.now() - start);
        if (first.messages.length !== 20) throw new Error(`${provider}: invalid fixture result`);
        fixture.resetReads();
        start = performance.now();
        const second = await fixture.read(id, 20, 20);
        warm.push(performance.now() - start);
        readBytes.push(fixture.reads().bytesRead);
        bodyBytes.push(Buffer.byteLength(JSON.stringify(second)));
        const httpId = await fixture.add(provider, size);
        ids.add(httpId);
        start = performance.now();
        let response = await fetch(`http://localhost:${address.port}/${httpId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
        httpCold.push(performance.now() - start);
        start = performance.now();
        response = await fetch(`http://localhost:${address.port}/${httpId}?offset=20`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
        http.push(performance.now() - start);
        global.gc?.();
        heap.push(process.memoryUsage().heapUsed - before);
      }
      const fails = readBytes.some((n) => n > historyBudgets.warmReadBytes);
      if (fails) structuralFailures++;
      const row = { provider, fixtureMessages: size, samples, coldReaderMs: summarize(cold), warmReaderMs: summarize(warm),
        coldHttpMs: summarize(httpCold), warmHttpMs: summarize(http), warmReadBytes: summarize(readBytes), pageBytes: summarize(bodyBytes),
        retainedHeapDeltaBytes: summarize(heap), warmReadTarget: fails ? 'FAIL' : 'PASS' };
      results.push(row);
      console.log(JSON.stringify(row));
    }
    const id = await fixture.add(provider, 200, 'heavy');
    const heavy = await fixture.read(id, 20, 180);
    const bytes = Buffer.byteLength(JSON.stringify(heavy));
    const fail = bytes > historyBudgets.pageBytes;
    if (fail) structuralFailures++;
    const row = { provider, profile: 'heavy', pageBytes: bytes, pageTarget: fail ? 'FAIL' : 'PASS' };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  if (historySourceState().sourceSha256 !== source.sourceSha256) throw new Error('Runtime source changed during measurement; rerun');
  const report = { schema: 1, source, fixtureVersion: HISTORY_FIXTURE_VERSION, node: process.version, platform: process.platform,
    architecture: process.arch, timestamp: new Date().toISOString(), samples,
    notes: ['cold means first app read, not cleared OS disk cache', 'HTTP is loopback fixture transport, excludes production auth/TLS',
      'heap delta is post-GC retained heap, not peak or total service memory', 'timing budgets are targets, not normal CI gates'],
    budgets: historyBudgets, results, structuralFailures };
  if (arg('output')) await writeFile(arg('output')!, JSON.stringify(report, null, 2) + '\n');
  console.log(`History benchmark: ${structuralFailures} structural target failures`);
  if (process.argv.includes('--check') && structuralFailures) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fixture.close();
}
