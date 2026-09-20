import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createHistoryFixture } from '../../server/modules/providers/tests/chat-history.fixture.js';
import { historySourceState } from './source-state.js';
import { HISTORY_FIXTURE_VERSION } from './fixtures.js';

const buildDir = await mkdtemp(path.join(os.tmpdir(), 'clide-history-browser-'));
let fixture: Awaited<ReturnType<typeof createHistoryFixture>> | undefined;
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
const source = historySourceState();
try {
  await build({ configFile: false, envFile: false, root: process.cwd(), publicDir: false,
    plugins: [{ name: 'history-counters', enforce: 'pre', transform(code, id) {
      let needle: string | undefined, counter: string | undefined;
      if (id.endsWith('/MessageComponent.tsx')) { needle = '}: MessageComponentProps) => {'; counter = 'rows'; }
      if (id.endsWith('/Markdown.tsx')) { needle = '}: MarkdownProps) {'; counter = 'markdown'; }
      if (id.endsWith('/useChatMessages.ts')) { needle = 'const outputStart = converted.length;'; counter = 'conversions'; }
      if (!needle || !counter) return;
      if (!code.includes(needle)) throw new Error(`Counter seam changed: ${id}`);
      return code.replace(needle, `${needle}\n(globalThis.__historyCounters ??= { rows: 0, markdown: 0, conversions: 0 }).${counter} += 1;`);
    } }, react()],
    resolve: { alias: { '@': path.resolve('src') } },
    build: { outDir: buildDir, emptyOutDir: true, rollupOptions: { input: path.resolve('scripts/chat-history/browser.html') } },
  });
  if (historySourceState().sourceSha256 !== source.sourceSha256) throw new Error('Runtime source changed during fixture build; rerun for a consistent baseline');
  fixture = await createHistoryFixture();
  const fixtures: Array<{ id: string; count: number }> = [];
  for (const count of [200, 1000]) fixtures.push({ id: await fixture.add('claude', count, 'mixed'), count });
  const allowed = new Set(fixtures.map((f) => f.id));
  const app = express();
  const reports: unknown[] = [];
  app.use(express.json({ limit: '64kb' }));
  app.post('/results', async (req, res) => {
    if (reports.length >= 30 || !allowed.has(req.body?.fixture?.id)) { res.sendStatus(400); return; }
    reports.push(req.body);
    if (output) await writeFile(output, JSON.stringify({ schema: 1, fixtureVersion: HISTORY_FIXTURE_VERSION, source,
      notes: ['Production fixture build, not the full deployed app', 'Counters add instrumentation overhead; conversions count cache misses, not input rows',
        'Browser device emulation does not establish real-phone acceptance', 'Chromium heap estimates are coarse; not a memory gate'], reports }, null, 2) + '\n');
    res.json({ saved: reports.length });
  });
  app.use((_req, res, next) => { res.setHeader('cache-control', 'no-store'); next(); });
  app.get('/favicon.ico', (_req, res) => { res.sendStatus(204); });
  app.get('/fixtures', (_req, res) => res.json(fixtures));
  app.get('/api/providers/sessions/:id/messages', async (req, res) => {
    if (!allowed.has(req.params.id)) { res.sendStatus(404); return; }
    try {
      const limit = req.query.limit === undefined ? null : Number(req.query.limit);
      const offset = Number(req.query.offset ?? 0);
      if ((limit !== null && (!Number.isInteger(limit) || limit < 0)) || !Number.isInteger(offset) || offset < 0) {
        res.sendStatus(400); return;
      }
      res.json({ success: true, data: await fixture!.read(req.params.id, limit, offset) });
    } catch { res.sendStatus(500); }
  });
  app.get('/api/providers/sessions/:id/token-usage', (req, res) => {
    if (!allowed.has(req.params.id)) { res.sendStatus(404); return; }
    res.json({ success: true, data: null });
  });
  app.get('/api/providers/claude/sessions/:id/:setting', (req, res) => {
    if (!allowed.has(req.params.id) || !['active-model', 'effort', 'token-usage'].includes(req.params.setting)) {
      res.sendStatus(404); return;
    }
    res.json({ success: true, data: { model: 'fixture', source: 'transcript', effort: null } });
  });
  app.get('/', (_req, res) => res.sendFile(path.join(buildDir, 'scripts/chat-history/browser.html')));
  app.use(express.static(buildDir));
  const server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`HISTORY_BROWSER_URL=http://localhost:${address.port}`);
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture!.close();
    await rm(buildDir, { recursive: true, force: true });
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
} catch (error) {
  await fixture?.close();
  await rm(buildDir, { recursive: true, force: true });
  throw error;
}
