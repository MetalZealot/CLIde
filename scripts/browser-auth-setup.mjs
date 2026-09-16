import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Playwright's authentication setup step: sign in once and save the storage state
// that Browser contexts start from (PLAYWRIGHT_MCP_STORAGE_STATE on the server).
// Run with node --env-file=<test credentials>. CLIDE_TEST_ALIAS_ORIGINS lists other
// addresses of the same server, which get the same sign-in. Origins already in the
// file for other servers are kept.
const {
  CLIDE_TEST_BASE_URL,
  CLIDE_TEST_ALIAS_ORIGINS = '',
  CLIDE_TEST_USERNAME,
  CLIDE_TEST_PASSWORD,
  PLAYWRIGHT_MCP_STORAGE_STATE,
} = process.env;
if (!CLIDE_TEST_BASE_URL || !CLIDE_TEST_USERNAME || !CLIDE_TEST_PASSWORD || !PLAYWRIGHT_MCP_STORAGE_STATE) {
  throw new Error('Set CLIDE_TEST_BASE_URL, CLIDE_TEST_USERNAME, CLIDE_TEST_PASSWORD and PLAYWRIGHT_MCP_STORAGE_STATE.');
}
const toOrigin = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Not an HTTP(S) origin: ${value}`);
  return url.origin;
};
const origin = toOrigin(CLIDE_TEST_BASE_URL);
const targets = [...new Set([origin, ...CLIDE_TEST_ALIAS_ORIGINS.split(/[\s,]+/).filter(Boolean).map(toOrigin)])];
const authFile = path.resolve(PLAYWRIGHT_MCP_STORAGE_STATE);
process.umask(0o077);
await fs.mkdir(path.dirname(authFile), { recursive: true, mode: 0o700 });

async function readExisting() {
  try {
    const state = JSON.parse(await fs.readFile(authFile, 'utf8'));
    return { cookies: Array.isArray(state.cookies) ? state.cookies : [], origins: Array.isArray(state.origins) ? state.origins : [] };
  } catch {
    return { cookies: [], origins: [] };
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(CLIDE_TEST_USERNAME);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(CLIDE_TEST_PASSWORD);
  const responsePromise = page.waitForResponse((response) =>
    response.url() === `${origin}/api/auth/login` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  if (!(await responsePromise).ok()) throw new Error('Test-account login failed.');
  await page.waitForFunction(() => Boolean(localStorage.getItem('auth-token')));
  const valid = await page.evaluate(async () => {
    const response = await fetch('/api/auth/user', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` },
    });
    return response.ok;
  });
  if (!valid) throw new Error('Authenticated test-account check failed.');

  const fresh = await page.context().storageState();
  const signedIn = fresh.origins.find((entry) => entry.origin === origin);
  if (!signedIn) throw new Error('No storage recorded for the test origin.');
  const existing = await readExisting();
  const state = {
    cookies: [
      ...existing.cookies.filter((old) => !fresh.cookies.some((cookie) =>
        cookie.name === old.name && cookie.domain === old.domain && cookie.path === old.path)),
      ...fresh.cookies,
    ],
    origins: [
      ...existing.origins.filter((entry) => !targets.includes(entry.origin)),
      ...targets.map((target) => ({ origin: target, localStorage: signedIn.localStorage })),
    ],
  };
  const next = `${authFile}.next`;
  await fs.writeFile(next, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(next, authFile);
  console.log(`Browser sign-in saved for ${targets.join(', ')}.`);
} catch {
  // Playwright errors can echo fill arguments; never print the underlying error.
  console.error('Browser authentication setup failed; no authenticated state was confirmed.');
  process.exitCode = 1;
} finally {
  await browser.close();
}
