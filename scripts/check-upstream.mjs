#!/usr/bin/env node
// Answers "what has upstream done since our merge base, and has it been
// assessed?" in one command.
//
// Every upstream sync started the same way: fetch, work out the merge base,
// scroll the commit list, hunt for the changelog, then try to remember which
// PRs a previous session already ruled on. That preamble is mechanical, so it
// lives here. The judgement calls stay with the reader: the procedure is in
// docs/maps/upstream-sync.md, the verdicts in docs/maps/upstream-verdicts.tsv.
//
// Run: npm run check:upstream [-- --offline] [-- --all]
//
//   (default)   merge base, version pins, the changelog span, and every
//               unassessed commit. Commits already ruled on are collapsed to
//               a count.
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
const VERDICTS = 'docs/maps/upstream-verdicts.tsv';

/** A commit touching more files than this is a restructure, not a change.
 *  Upstream #1206 moved 702 files; everything after it needs reimplementing
 *  rather than cherry-picking, so the boundary has to be visible here. */
const RESTRUCTURE_FILES = 200;

/** Upstream's release machinery is their operational surface, never a CLIde
 *  change: npm publishing, release-it, the README rewrite that would restore
 *  their branding, and Electron packaging. Refused permanently, so it is
 *  classified by subject rather than re-listed every release. */
const RELEASE_NOISE = /^chore\(release\)|release-it|npm (publish|release)|\breadme\b|electron/i;

/** Areas CLIde deleted: the desktop app, Docker sandbox, npm release tooling,
 *  CloudCLI's own plugin system, the external agent API, non-English locales and
 *  upstream's repo chrome.
 *  A commit touching only these has nothing to apply to. Claude Code's and
 *  Codex's plugins live elsewhere and are not covered. */
const REMOVED_AREAS = [
  /^electron\//, /^docker\//, /^redirect-package\//, /^scripts\/release\//,
  /^release\.sh$/, /^\.release-it\.json$/, /^\.npmignore$/, /^CHANGELOG\.md$/,
  /^README\.[^/]+\.md$/, /^\.github\//, /^\.gitmodules$/, /^plugins\//,
  /^server\/modules\/plugins\//, /^src\/components\/plugins\//,
  /^src\/contexts\/PluginsContext\.tsx$/, /^src\/i18n\/locales\/(?!en\/)/,
  /^server\/modules\/agent\//, /^public\/api-docs\.html$/,
];
const onlyRemovedAreas = (paths) => paths.length > 0
  && paths.every((file) => REMOVED_AREAS.some((area) => area.test(file)));

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const good = (s) => `\x1b[32m${s}\x1b[0m`;

// --- what has been ruled on ----------------------------------------------

const VERDICT_LINE = /^(#\d{2,6}|[0-9a-f]{7,40})\t(ours|refused|declined|deferred)\t(.+)$/;

/** Ref → verdict. A line that names a ref but does not parse is reported, not skipped. */
function readVerdicts() {
  let text;
  try {
    text = readFileSync(path.join(ROOT, VERDICTS), 'utf8');
  } catch {
    return { byRef: new Map(), malformed: [], missing: true };
  }
  const byRef = new Map();
  const malformed = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || /^#(\s|$)/.test(line)) return;
    const m = line.match(VERDICT_LINE);
    if (m) byRef.set(m[1], m[2]);
    else malformed.push(i + 1);
  });
  return { byRef, malformed, missing: false };
}

const verdictFor = (byRef, c) => byRef.get(c.pr ? `#${c.pr}` : '')
  ?? [...byRef].find(([ref]) => !ref.startsWith('#') && c.full.startsWith(ref))?.[1]
  ?? null;

// --- report ---------------------------------------------------------------

const verdicts = readVerdicts();
const out = [];
const say = (s = '') => out.push(s);

if (verdicts.missing) {
  say(warn(`${VERDICTS} is missing — every commit below will read as unassessed.`));
  say('');
}
if (verdicts.malformed.length) {
  say(warn(`${VERDICTS}: line(s) ${verdicts.malformed.join(', ')} do not parse as "ref<TAB>verdict<TAB>reason".`));
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
  const paths = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
  return { sha: sha.slice(0, 8), full: sha, subject, files: paths.length, paths, pr: subject.match(/\(#(\d+)\)/)?.[1] ?? null };
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

/** What git itself says this fork carries: `cherry-pick -x` lines, `Upstream:` footers,
 *  and upstream patches with an identical change on HEAD (`git cherry` marks them `-`). */
const carriedRefs = new Set();
for (const body of (tryGit('log', '--format=%B%x00', `${base}..HEAD`) ?? '').split('\0')) {
  for (const m of body.matchAll(/^\(cherry picked from commit ([0-9a-f]{40})\)$/gm)) carriedRefs.add(m[1]);
  for (const m of body.matchAll(/^Upstream:\s*(.+)$/gm)) {
    for (const ref of m[1].match(/#\d{2,6}|[0-9a-f]{7,40}/g) ?? []) carriedRefs.add(ref);
  }
}
for (const line of (tryGit('cherry', 'HEAD', 'upstream/main', base) ?? '').split('\n')) {
  if (line.startsWith('- ')) carriedRefs.add(line.slice(2));
}
const carried = (c) => (c.pr && carriedRefs.has(`#${c.pr}`))
  || [...carriedRefs].some((ref) => !ref.startsWith('#') && c.full.startsWith(ref));

const rows = commits.map((c, i) => {
  let verdict = 'NEW';
  if (RELEASE_NOISE.test(c.subject)) verdict = 'release';
  else if (onlyRemovedAreas(c.paths)) verdict = 'removed';
  else if (carried(c)) verdict = 'carried';
  else verdict = verdictFor(verdicts.byRef, c) ?? 'NEW';
  return { ...c, verdict, side: i > afterIndex ? 'reimplement' : 'pickable' };
});

const unassessed = rows.filter((r) => r.verdict === 'NEW');
const known = rows.length - unassessed.length;

say(bold(`Commits since merge base: ${rows.length}`));
say(dim(`  ${known} already ruled on: a verdict line, carried in git, release plumbing, or only in areas CLIde removed`));
say('');

const show = args.has('--all') ? rows : unassessed;
if (show.length === 0) {
  say(good('  Every commit in this span has been assessed.'));
} else {
  say(bold(args.has('--all') ? 'All commits' : 'Unassessed — these need a verdict'));
  for (const r of show) {
    const tag = {
      NEW: warn('NEW     '),
      ours: good('ours    '),
      carried: good('carried '),
      refused: dim('refused '),
      declined: dim('declined'),
      deferred: warn('deferred'),
      release: dim('release '),
      removed: dim('removed '),
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
say(dim(`Record each verdict in ${VERDICTS}; take a patch with \`git cherry-pick -x\`, or footer a reimplementation \`Upstream: #1234\`.`));
console.log(out.join('\n'));
