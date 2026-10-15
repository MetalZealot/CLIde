// Runs the chat scroll scenarios (scenarios.ts) headless, each on a fresh page, in the
// phone page layout and the desktop pane, and exits non-zero when any check fails.
//   npm run test:chat-scroll -- --reference=<transcript.jsonl>[,<another.jsonl>] [--only=open,nudge] [--layout=phone|desktop] [--trace]
// Without --reference (or CHAT_HISTORY_REFERENCE) it runs on the synthetic tool-burst fixture.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const reference = arg('reference') ?? process.env.CHAT_HISTORY_REFERENCE;
const only = arg('only')?.split(',');
const trace = process.argv.includes('--trace');
/** --trace: every write to the scroll position, with the rows whose height changed since the previous write. */
const traceWrites = () => {
  window.__trace = [];
  let last = new Map();
  const snap = () => new Map(Array.from(document.querySelectorAll('.chat-rows > *'), (el, i) => [
    el.getAttribute('data-chat-message-id') || `#${i}`, Math.round(el.getBoundingClientRect().height)]));
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return desc.get.call(this); }, set(value) {
    const before = desc.get.call(this);
    desc.set.call(this, value);
    if (this !== document.documentElement && !this.classList.contains('chat-messages-pane')) return;
    const now = snap();
    const grew = [...now].filter(([id, h]) => last.has(id) && last.get(id) !== h).map(([id, h]) => `${id.slice(0, 8)} ${last.get(id)}->${h}`);
    window.__trace.push(`${Math.round(performance.now())}ms write ${Math.round(value)} ${Math.round(before)}->${Math.round(desc.get.call(this))} height=${this.scrollHeight} rows=${now.size} ${grew.join(' ')}`);
    last = now;
  } });
};
const layouts = [
  { name: 'phone', mode: 'page', context: { viewport: { width: 412, height: 880 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } },
  { name: 'desktop', mode: 'pane', context: { viewport: { width: 1280, height: 800 } } },
].filter((layout) => !arg('layout') || layout.name === arg('layout'));
const scenarios = ['open', 'followStream', 'nudge', 'readStream', 'readWalk', 'toggleReading', 'toggleFollowing',
  'composerFollow', 'composerRead', 'keyboardFollow', 'resizeRead', 'jumpReturn', 'refreshRead', 'selectionStream'];
/** A fault that depends on timing fails some runs and passes others; these run several times. */
const repeats = { open: 5 };
const fixtureCount = reference ? reference.split(',').length : 1;
const runList = Array.from({ length: fixtureCount }, (_, fixtureIndex) => (only ?? scenarios)
  .flatMap((name) => Array.from({ length: repeats[name] ?? 1 }, () => [fixtureIndex, name]))).flat();

const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/chat-history/browser-server.ts', ...(reference ? [`--reference=${reference}`] : [])], {
  cwd: root, env: { ...process.env, TSX_TSCONFIG_PATH: 'server/tsconfig.json' }, stdio: ['ignore', 'pipe', 'inherit'],
});
const url = await new Promise((resolve, reject) => {
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
    const match = /HISTORY_BROWSER_URL=(\S+)/.exec(output);
    if (match) resolve(match[1]);
  });
  server.once('exit', (code) => reject(new Error(`Harness server exited with ${code}`)));
});

const browser = await chromium.launch();
const results = [];
try {
  for (const layout of layouts) {
    const context = await browser.newContext(layout.context);
    if (trace) await context.addInitScript(traceWrites);
    for (const [fixtureIndex, name] of runList) {
      const page = await context.newPage();
      await page.exposeFunction('__benchResize', (width, height) => page.setViewportSize({ width, height }));
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const started = Date.now();
      let result;
      try {
        await page.goto(url);
        await page.waitForFunction(() => 'historyBench' in window);
        const fixtureId = await page.evaluate(([profile, index]) => {
          const matching = window.historyBench.fixtures.filter((fixture) => fixture.profile === profile);
          return (matching[index] ?? window.historyBench.fixtures.find((fixture) => fixture.profile === 'bursts')).id;
        }, [reference ? 'reference' : 'bursts', fixtureIndex]);
        result = await page.evaluate(([scenario, id, mode]) => window.historyBench.scenario(scenario, id, mode), [name, fixtureId, layout.mode]);
      } catch (error) {
        result = { checks: { ran: false }, data: { error: String(error.message ?? error).split('\n')[0] } };
      }
      if (errors.length) result.data.pageErrors = errors.slice(0, 3);
      const failed = Object.entries(result.checks).filter(([, passed]) => !passed).map(([check]) => check);
      results.push({ layout: layout.name, name: `${name}${fixtureCount > 1 ? `@${fixtureIndex}` : ''}`, seconds: Math.round((Date.now() - started) / 100) / 10, failed, data: result.data });
      console.log(`${failed.length ? 'FAIL' : 'pass'}  ${layout.name.padEnd(7)} ${results.at(-1).name.padEnd(18)} ${String(results.at(-1).seconds).padStart(5)}s  ${failed.join(', ')}  ${JSON.stringify(result.data)}`);
      if (trace) console.log((await page.evaluate(() => window.__trace ?? []).catch(() => [])).slice(0, 40).map((line) => `      ${line}`).join('\n'));
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
const failures = results.filter((result) => result.failed.length);
console.log(`\n${results.length - failures.length}/${results.length} scenarios pass`);
process.exitCode = failures.length ? 1 : 0;
