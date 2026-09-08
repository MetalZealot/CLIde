#!/usr/bin/env node
// Answers "what has upstream done since our merge base, and has it been
// assessed?" in one command.
//
// Every upstream sync started the same way: fetch, work out the merge base,
// scroll the commit list, hunt for the changelog, then try to remember which
// PRs a previous session already ruled on. That preamble is mechanical, so it
// lives here. The judgement calls stay with the reader, in
// docs/maps/upstream-sync.md.
//
// Run: npm run check:upstream [-- --offline] [-- --all]
//
//   (default)   merge base, version pins, the changelog span, and every
//               unassessed commit. Commits already ruled on in the map are
//               collapsed to a count.
//   --all       list assessed commits too, with their verdict
//   --offline   skip the fetch and read whatever refs are local
//
// Exits 0 always: this reports, it does not gate.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const MAP = 'docs/maps/upstream-sync.md';

/** A commit touching more files than this is a restructure, not a change.
 *  Upstream #1206 moved 702 files; everything after it needs reimplementing
 *  rather than cherry-picking, so the boundary has to be visible here. */
const RESTRUCTURE_FILES = 200;

/** Upstream's release machinery is their operational surface, never a CLIde
 *  change: npm publishing, release-it, the README rewrite that would restore
 *  their branding, and Electron packaging. Refused permanently, so it is
 *  classified by subject rather than re-listed every release. */
const RELEASE_NOISE = /^chore\(release\)|release-it|npm (publish|release)|\breadme\b|electron/i;

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const good = (s) => `\x1b[32m${s}\x1b[0m`;

// --- the map is the memory ------------------------------------------------

/** Every `#1234` the map mentions has been ruled on by some session. The
 *  refusal table is read separately so a refusal is never reported as new. */
function readMap() {
  let text;
  try {
    text = readFileSync(path.join(ROOT, MAP), 'utf8');
  } catch {
    return { assessed: new Set(), refused: new Set(), mergeBase: null, missing: true };
  }
  const prs = (s) => new Set([...s.matchAll(/#(\d{2,6})\b/g)].map((m) => m[1]));
  const refusedSection = text.split(/^## Refused permanently$/m)[1]?.split(/^## /m)[0] ?? '';
  const mergeBase = text.match(/\*\*Merge base:\*\*\s*`([0-9a-f]{7,40})`/)?.[1] ?? null;
  return { assessed: prs(text), refused: prs(refusedSection), mergeBase, missing: false };
}

// --- report ---------------------------------------------------------------

const map = readMap();
const out = [];
const say = (s = '') => out.push(s);

if (map.missing) {
  say(warn(`${MAP} is missing — every commit below will read as unassessed.`));
  say('');
}

if (!args.has('--offline')) {
  process.stderr.write('fetching upstream… ');
  const fetched = tryGit('fetch', 'upstream', '--tags');
  process.stderr.write(fetched === null ? 'failed (continuing offline)\n' : 'done\n');
}

const upstreamHead = tryGit('rev-parse', '--short', 'upstream/main');
if (!upstreamHead) {
  console.log(warn('No upstream/main ref. Add the remote, or drop --offline.'));
  process.exit(0);
}

const base = git('merge-base', 'HEAD', 'upstream/main');
const baseShort = base.slice(0, 8);
const baseSubject = git('log', '--format=%s', '-1', base);

say(bold('Position'));
say(`  merge base      ${baseShort}  ${baseSubject}`);
say(`  upstream/main   ${upstreamHead}  ${git('log', '--format=%s', '-1', 'upstream/main')}`);

const ourVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const theirVersion = JSON.parse(git('show', 'upstream/main:package.json')).version;
say(`  version         ours ${ourVersion} · upstream ${theirVersion} ${dim('(parity abandoned; not a defect)')}`);

if (map.mergeBase && !base.startsWith(map.mergeBase)) {
  say(warn(`  ${MAP} records merge base ${map.mergeBase}; the tree says ${baseShort}. Update the map.`));
}
say('');

// --- commits --------------------------------------------------------------

const revs = git('rev-list', '--reverse', `${base}..upstream/main`).split('\n').filter(Boolean);
if (revs.length === 0) {
  say(good('Nothing new upstream.'));
  console.log(out.join('\n'));
  process.exit(0);
}

const commits = revs.map((sha) => {
  const subject = git('log', '--format=%s', '-1', sha);
  const files = Number(git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean).length);
  return { sha: sha.slice(0, 8), subject, files, pr: subject.match(/\(#(\d+)\)/)?.[1] ?? null };
});

const restructures = commits.filter((c) => c.files >= RESTRUCTURE_FILES);
if (restructures.length) {
  say(bold('Restructures in this span'));
  for (const c of restructures) {
    say(`  ${warn(c.sha)}  ${String(c.files).padStart(4)} files  ${c.subject}`);
  }
  say(dim('  Commits after a restructure land in paths this fork may not have.'));
  say(dim('  Read them and reimplement; do not plan a cherry-pick.'));
  say('');
}

const lastRestructure = restructures.at(-1);
const afterIndex = lastRestructure ? commits.findIndex((c) => c.sha === lastRestructure.sha) : -1;

/** A PR this fork already carries under its own commit message. */
const carried = (pr) => Boolean(pr) && tryGit('log', '--format=%h', '--grep', `#${pr}`, 'HEAD')?.length > 0;

const rows = commits.map((c, i) => {
  let verdict = 'NEW';
  if (RELEASE_NOISE.test(c.subject)) verdict = 'release';
  else if (c.pr && map.refused.has(c.pr)) verdict = 'refused';
  else if (c.pr && map.assessed.has(c.pr)) verdict = 'assessed';
  else if (carried(c.pr)) verdict = 'carried';
  return { ...c, verdict, side: i > afterIndex ? 'reimplement' : 'pickable' };
});

const unassessed = rows.filter((r) => r.verdict === 'NEW');
const known = rows.length - unassessed.length;

say(bold(`Commits since merge base: ${rows.length}`));
say(dim(`  ${known} already ruled on: in the map, carried under our own commit, or release plumbing`));
say('');

const show = args.has('--all') ? rows : unassessed;
if (show.length === 0) {
  say(good('  Every commit in this span has been assessed.'));
} else {
  say(bold(args.has('--all') ? 'All commits' : 'Unassessed — these need a verdict'));
  for (const r of show) {
    const tag = {
      NEW: warn('NEW    '),
      refused: dim('refused'),
      release: dim('release'),
      assessed: dim('assessed'),
      carried: good('carried'),
    }[r.verdict];
    const pr = r.pr ? `#${r.pr}`.padEnd(6) : '      ';
    say(`  ${tag} ${r.sha} ${pr} ${dim(r.side.padEnd(11))} ${r.subject}`);
  }
}
say('');

// --- changelog ------------------------------------------------------------
// Reading only the newest entry is how a release's real content gets missed,
// so the whole span prints by default.

const changelog = tryGit('show', 'upstream/main:CHANGELOG.md');
if (changelog) {
  const baseVersion = (() => {
    try { return JSON.parse(git('show', `${base}:package.json`)).version; } catch { return null; }
  })();
  const lines = changelog.split('\n');
  const stopAt = baseVersion
    ? lines.findIndex((l) => l.startsWith(`## [${baseVersion}]`))
    : -1;
  const span = stopAt > 0 ? lines.slice(0, stopAt) : lines.slice(0, 120);
  say(bold(`Changelog span${baseVersion ? ` (down to our base, ${baseVersion})` : ' (first 120 lines)'}`));
  say(span.join('\n').trim());
  say('');
  say(dim('Read the whole span. Upstream squashes a release into a few PRs, so one'));
  say(dim('entry routinely hides a restructure.'));
} else {
  say(warn('No upstream CHANGELOG.md found.'));
}

say('');
say(dim(`Verdicts, refusals and the ledger live in ${MAP}.`));
console.log(out.join('\n'));
