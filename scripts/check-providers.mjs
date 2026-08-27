#!/usr/bin/env node
// Answers "did the provider CLIs and SDKs move, and does CLIde care?" in one command.
//
// Every provider upgrade started the same way: half an hour of `npm view`, `npm
// pack`, tarball diffs and changelog hunting before any decision could be made.
// That preamble is mechanical, so it lives here. The judgement calls — what to
// adopt, defer or ignore — stay with the reader.
//
// Run: npm run check:providers [-- --notes] [-- --types] [-- --protocol] [-- --all]
//
//   (default)   local vs published versions, plus the drift verdict
//   --notes     release notes between the installed and published versions
//   --types     signature-only diff of each SDK's .d.ts (downloads tarballs)
//   --protocol  regenerates Codex App Server bindings and counts them (slow)
//
// Exits 0 always: this reports, it does not gate. The gates are the drift tests.

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const require_ = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const want = (flag) => args.has('--all') || args.has(flag);

const OUT = mkdtempSync(path.join(os.tmpdir(), 'clide-providers-'));
const artifacts = [];

/** Longest release-note excerpt printed inline; the rest goes to a file. */
const INLINE_NOTE_LINES = 40;
/** Longest type diff printed inline. */
const INLINE_DIFF_LINES = 60;

const say = (s = '') => console.log(s);
const run = (cmd, argv, opts = {}) => {
  try {
    return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch {
    return null;
  }
};

const stash = (name, body) => {
  const file = path.join(OUT, name);
  writeFileSync(file, body, 'utf8');
  artifacts.push(file);
  return file;
};

// --- versions ---------------------------------------------------------------

/** Compares dotted numeric versions; prerelease suffixes sort before the release. */
const compareVersions = (a, b) => {
  if (!a || !b) return 0;
  const parts = (v) => v.split('-')[0].split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  const [sa, sb] = [a.includes('-'), b.includes('-')];
  if (sa !== sb) return sa ? -1 : 1;
  return 0;
};

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

const pinned = (name) => manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? null;
const locked = (name) => lockfile.packages?.[`node_modules/${name}`]?.version ?? null;
const published = (name) => (args.has('--offline') ? null : run('npm', ['view', name, 'version']));

/** Directory an installed package occupies, or null. Read straight out of
 *  `node_modules` rather than resolved: `@openai/codex-sdk` declares no exports
 *  main, so `require.resolve` throws on the bare specifier. */
const packageDir = (name) => {
  const dir = path.join(ROOT, 'node_modules', name);
  return existsSync(path.join(dir, 'package.json')) ? dir : null;
};

const installed = (name) => {
  const dir = packageDir(name);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
};

/** First executable of this name a plain shell would find, symlinks resolved.
 *  `node_modules/.bin` is skipped: npm prepends it, which would report the
 *  bundled copy as the standalone install and hide a real version gap. */
const onPath = (bin) => {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    if (dir.split(path.sep).includes('node_modules')) continue;
    const candidate = path.join(dir, bin);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
};

const versionOf = (output) => output?.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\b/)?.[0] ?? null;

const rows = [];
const record = (label, local, remote, note) => rows.push({ label, local, remote, note });

// Claude: the SDK is pinned, the runtime is not — that asymmetry is deliberate,
// so they are reported as two independent moving parts rather than one pair.
const claudeSdk = installed('@anthropic-ai/claude-agent-sdk');
const claudeSdkLatest = published('@anthropic-ai/claude-agent-sdk');
record('Claude SDK', claudeSdk, claudeSdkLatest, `pinned ${pinned('@anthropic-ai/claude-agent-sdk') ?? '—'}, lockfile ${locked('@anthropic-ai/claude-agent-sdk') ?? '—'}`);

let bundledRuntime = null;
try {
  bundledRuntime = JSON.parse(readFileSync(path.join(packageDir('@anthropic-ai/claude-agent-sdk'), 'manifest.zst.json'), 'utf8')).version ?? null;
} catch { /* manifest absent */ }

const claudeBin = onPath('claude');
const claudeRuntime = versionOf(claudeBin && run(claudeBin, ['--version']));
record('Claude runtime', claudeRuntime, published('@anthropic-ai/claude-code'), `on PATH${bundledRuntime ? `; SDK bundles ${bundledRuntime} as fallback` : ''}`);

const codexSdk = installed('@openai/codex-sdk');
record('Codex SDK', codexSdk, published('@openai/codex-sdk'), `pinned ${pinned('@openai/codex-sdk') ?? '—'} (exact by contract)`);

const codexBundled = installed('@openai/codex');
record('Codex CLI (bundled)', codexBundled, published('@openai/codex'), 'transitive through the SDK');

const codexBin = onPath('codex');
record('Codex CLI (on PATH)', versionOf(codexBin && run(codexBin, ['--version'])), null, 'standalone install, selectable at runtime');

say('Provider versions\n');
const width = Math.max(...rows.map((r) => r.label.length));
for (const { label, local, remote, note } of rows) {
  const moved = remote && local && compareVersions(local, remote) < 0;
  const mark = moved ? '  ← newer published' : '';
  say(`  ${label.padEnd(width)}  ${(local ?? 'not installed').padEnd(10)} ${remote ? `(published ${remote})` : ''}${mark}`);
  say(`  ${' '.repeat(width)}  ${note}`);
}

// The failure that cost the most time: the model registry silently relocating.
if (claudeBin) {
  const MARKER = 'models:[{id:"claude-';
  const found = scanFor(claudeBin, MARKER) !== null;
  const inSdk = (() => {
    try {
      return readFileSync(path.join(packageDir('@anthropic-ai/claude-agent-sdk'), 'sdk.mjs'), 'utf8').includes(MARKER);
    } catch { return false; }
  })();
  say(`\n  Claude model registry: ${found ? 'present in the runtime binary' : 'NOT FOUND in the runtime binary'}${inSdk ? ', also in the SDK bundle' : ''}`);
  if (!found) say('  → claude-context.test.ts parses this marker; it will fail until the parser is repointed.');
}

/** Byte offset of a marker in a possibly-huge file, or null. Chunked so a 250 MB
 *  native binary never lands in a string. */
function scanFor(file, marker) {
  const CHUNK = 1 << 20;
  const size = statSync(file).size;
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK);
    let carry = Buffer.alloc(0);
    let position = 0;
    while (position < size) {
      const read = readSync(fd, buffer, 0, CHUNK, position);
      if (read <= 0) break;
      const scanned = Buffer.concat([carry, buffer.subarray(0, read)]);
      const hit = scanned.indexOf(marker, 0, 'latin1');
      if (hit >= 0) return position - carry.length + hit;
      carry = scanned.subarray(Math.max(0, scanned.length - marker.length));
      position += read;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// --- release notes ----------------------------------------------------------

if (want('--notes')) {
  say('\n\nRelease notes\n');

  // Claude Code publishes one changelog for every version, including the ones
  // the SDK wraps; the SDK itself publishes none.
  await section('Claude Code', async () => {
    const res = await fetch('https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md');
    if (!res.ok) return `changelog fetch failed (${res.status})`;
    const text = await res.text();
    const headings = [...text.matchAll(/^## (\d+\.\d+\.\d+)$/gm)];
    const from = claudeRuntime;
    const newer = headings.filter((h) => !from || compareVersions(h[1], from) > 0);
    if (!newer.length) return `nothing published above ${from ?? 'the installed version'}`;
    const body = text.slice(newer.at(-1).index, headings.find((h) => h[1] === from)?.index ?? text.length);
    return excerpt(body, `claude-code-${from}-to-${newer[0][1]}.md`, `${newer.length} release(s) since ${from}`);
  });

  // Codex tags every release on GitHub; alphas are noise here.
  await section('Codex', async () => {
    const res = await fetch('https://api.github.com/repos/openai/codex/releases?per_page=40', {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return `releases fetch failed (${res.status})`;
    const from = codexSdk;
    const releases = (await res.json())
      .map((r) => ({ version: r.tag_name?.replace(/^rust-v/, ''), body: r.body ?? '' }))
      .filter((r) => r.version && !r.version.includes('alpha') && (!from || compareVersions(r.version, from) > 0));
    if (!releases.length) return `nothing published above ${from ?? 'the installed version'}`;
    // The commit list under "## Changelog" is hundreds of lines of internal PRs.
    const body = releases
      .map((r) => `## ${r.version}\n\n${r.body.split(/^## Changelog$/m)[0].trim()}`)
      .join('\n\n');
    return excerpt(body, `codex-${from}-to-${releases[0].version}.md`, `${releases.length} release(s) since ${from}`);
  });
}

async function section(title, produce) {
  say(`--- ${title} ---`);
  try {
    say(await produce());
  } catch (error) {
    say(`  unavailable: ${error.message}`);
  }
  say('');
}

/** Prints the head of a long body and files the rest, so output stays bounded. */
function excerpt(body, name, summary) {
  const file = stash(name, body);
  const lines = body.split('\n');
  const head = lines.slice(0, INLINE_NOTE_LINES).join('\n');
  const rest = lines.length > INLINE_NOTE_LINES ? `\n  … ${lines.length - INLINE_NOTE_LINES} more lines in ${file}` : '';
  return `  ${summary}\n\n${head}${rest}`;
}

// --- type surfaces ----------------------------------------------------------

if (want('--types')) {
  say('\n\nType surface diffs\n');
  const targets = [
    { pkg: '@anthropic-ai/claude-agent-sdk', files: ['sdk.d.ts', 'sdk-tools.d.ts'], installedDir: () => packageDir('@anthropic-ai/claude-agent-sdk') },
    { pkg: '@openai/codex-sdk', files: ['dist/index.d.ts'], installedDir: () => packageDir('@openai/codex-sdk') },
  ];

  for (const target of targets) {
    const latest = published(target.pkg);
    const here = installed(target.pkg);
    say(`--- ${target.pkg}: ${here} → ${latest ?? '?'} ---`);
    if (!latest || latest === here) {
      say('  already current\n');
      continue;
    }
    const pack = run('npm', ['pack', `${target.pkg}@${latest}`, '--pack-destination', OUT], { cwd: OUT });
    const tarball = pack?.split('\n').at(-1)?.trim();
    if (!tarball) {
      say('  npm pack failed\n');
      continue;
    }
    run('tar', ['xzf', path.join(OUT, tarball), '-C', OUT]);
    for (const file of target.files) {
      const a = path.join(target.installedDir(), file);
      const b = path.join(OUT, 'package', file);
      if (!existsSync(a) || !existsSync(b)) {
        say(`  ${file}: ${existsSync(a) ? 'gone from the new package' : 'absent locally'} — a relocation, look before assuming`);
        continue;
      }
      // Doc comments dominate these diffs and carry no contract; strip them.
      const raw = run('diff', ['-u', a, b]) ?? '';
      const signatures = raw.split('\n')
        .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
        .filter((l) => !/^[+-]\s*(\*|\/\*|\*\/)/.test(l) && l.trim().length > 1);
      if (!signatures.length) {
        say(`  ${file}: comments only, no signature changes`);
        continue;
      }
      const dest = stash(`${target.pkg.replace(/\W+/g, '-')}-${file.replace(/\W+/g, '-')}.diff`, signatures.join('\n'));
      say(`  ${file}: ${signatures.length} signature line(s) changed`);
      say(signatures.slice(0, INLINE_DIFF_LINES).map((l) => `    ${l}`).join('\n'));
      if (signatures.length > INLINE_DIFF_LINES) say(`    … rest in ${dest}`);
    }
    say('');
  }
}

// --- Codex App Server protocol ---------------------------------------------

if (want('--protocol')) {
  say('\n\nCodex App Server protocol\n');
  let bin = null;
  try { bin = require_.resolve('@openai/codex/bin/codex.js'); } catch { /* absent */ }
  if (!bin) {
    say('  @openai/codex is not installed\n');
  } else {
    for (const mode of ['default', 'experimental']) {
      const dir = path.join(OUT, `protocol-${mode}`);
      run('node', [bin, 'app-server', 'generate-ts', ...(mode === 'experimental' ? ['--experimental'] : []), '--out', dir]);
      const count = (f) => {
        try {
          return (readFileSync(path.join(dir, f), 'utf8').match(/"method":\s*"/g) ?? []).length;
        } catch { return 0; }
      };
      say(`  ${mode.padEnd(12)} ${count('ClientRequest.ts')} client, ${count('ServerRequest.ts')} server, ${count('ServerNotification.ts')} notifications`);
    }
    say('\n  Compare against the counts in docs/maps/codex-cli-sdk-app-server.md.');
  }
}

// --- where to go next -------------------------------------------------------

say('\nNext, if anything moved:');
say('  1. Bump the pin, `npm install`, then `npm test` — the drift tests name what broke.');
say('  2. Classify each change: consumed, candidate, watch, or no action.');
say('  3. Append one ledger entry and update the map rows you actually re-measured.');
if (artifacts.length) say(`\nArtifacts: ${OUT}`);
