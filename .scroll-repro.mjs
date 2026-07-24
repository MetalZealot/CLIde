// Scroll-to-top repro harness for CLIde chat pane.
// Drives http://localhost:3001/session/<id> in headless Chromium, flings the
// message pane upward, and logs scroll state + pagination network traffic.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const TOKEN = readFileSync('/tmp/clide-repro-token', 'utf8').trim();
const SESSION_ID = process.argv[2] || '5f4e9168-9ad0-4ea5-819e-2f5200d7b043';
const BASE = 'http://localhost:3001';

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 883 } });

await page.addInitScript((token) => {
  localStorage.setItem('auth-token', token);
  localStorage.setItem('selected-provider', 'claude');
}, TOKEN);

page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error' && !t.includes('favicon')) log('CONSOLE-ERR:', t.slice(0, 300));
});
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/messages')) {
    const q = new URL(url).searchParams;
    let info = '';
    try {
      const body = await res.json();
      const d = body?.data ?? body;
      info = `-> page:${(d.messages || []).length} total:${d.total} hasMore:${d.hasMore}`;
    } catch { info = '-> (unparsed)'; }
    log(`NET ${res.status()} limit=${q.get('limit')} offset=${q.get('offset')} ${info}`);
  }
});

await page.goto(`${BASE}/session/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-messages-pane', { timeout: 20000 });

// Let initial load + initial-scroll settle
await page.waitForTimeout(4000);

const state = () => page.evaluate(() => {
  const c = document.querySelector('.chat-messages-pane');
  return {
    top: Math.round(c.scrollTop),
    height: c.scrollHeight,
    client: c.clientHeight,
    rendered: document.querySelectorAll('.chat-message').length,
    spinner: !!c.querySelector('.animate-spin'),
    indicator: (c.querySelector('.border-b.py-2')?.textContent || '').slice(0, 80),
  };
});

log('INITIAL', JSON.stringify(await state()));

// Fling upward repeatedly. Hover center of pane so wheel targets it.
const box = await page.locator('.chat-messages-pane').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

let stuckCount = 0;
let prev = await state();
for (let i = 0; i < 120; i++) {
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(250);
  const s = await state();
  const moved = s.top !== prev.top || s.height !== prev.height || s.rendered !== prev.rendered;
  log(`#${String(i).padStart(3)} top=${s.top} h=${s.height} rendered=${s.rendered} spin=${s.spinner ? 1 : 0} ${moved ? '' : 'STUCK'} ${s.indicator ? '| ' + s.indicator.trim() : ''}`);
  if (s.top === 0 && !moved) {
    stuckCount++;
    if (stuckCount >= 12) { log('DEAD ROOF: 12 consecutive stuck ticks at top'); break; }
  } else {
    stuckCount = 0;
  }
  prev = s;
}

log('FINAL', JSON.stringify(await state()));
await browser.close();
