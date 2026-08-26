#!/usr/bin/env node
// Keeps the test suite cheap to run.
//
// Cost is per test *file*, not per test: each one pays process spawn, type
// stripping, and (on the client) JSDOM setup before its first assertion. So the
// suite's wall time tracks the file count, and a file the runner never collects
// is worse than useless — it looks like coverage and asserts nothing.
//
// Run: npm run check:tests

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Raising a budget is a deliberate act: a new file costs seconds on every run,
 *  and adding cases to an existing file costs nothing. Merge first, then justify
 *  the number in the commit message. */
const HALVES = [
  { name: 'server', dir: 'server', collected: /\.test\.(ts|js)$/, budget: 39 },
  { name: 'client', dir: 'src', collected: /\.test\.tsx?$/, budget: 17 },
];

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-server', '.git']);

function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.name.includes('.test.')) found.push(relative(ROOT, full));
  }
  return found;
}

const countCases = (file) =>
  (readFileSync(join(ROOT, file), 'utf8').match(/^\s*(it|test)(\.\w+)?\(/gm) ?? []).length;

const failures = [];
const advice = [];
const collectedPerHalf = [];

for (const { name, dir, collected, budget } of HALVES) {
  const files = walk(join(ROOT, dir));

  for (const orphan of files.filter((f) => !collected.test(f))) {
    failures.push(`${orphan} is never run — test:${name}'s glob does not match its extension.`);
  }

  const running = files.filter((f) => collected.test(f));
  collectedPerHalf.push(`${name} ${running.length}`);

  if (running.length > budget) {
    failures.push(
      `test:${name} collects ${running.length} files, over its budget of ${budget}. ` +
        'Fold the new cases into an existing file, or raise the budget in this script deliberately.',
    );
  }

  // Only worth flagging where a merge is actually available: a module's sole test
  // file has nowhere to go, and moving it would cross a module boundary for ~3s.
  const perDirectory = new Map();
  for (const file of running) {
    const key = dirname(file);
    perDirectory.set(key, (perDirectory.get(key) ?? 0) + 1);
  }
  for (const file of running) {
    if (perDirectory.get(dirname(file)) < 2) continue;
    const cases = countCases(file);
    if (cases > 0 && cases < 3) {
      advice.push(`${file} holds ${cases} case${cases === 1 ? '' : 's'} beside larger files in the same directory.`);
    }
  }
}

if (advice.length) {
  console.warn('Cheapest merges available:\n' + advice.map((line) => `  ${line}`).join('\n'));
}

if (failures.length) {
  console.error('\ncheck:tests failed:\n' + failures.map((line) => `  ${line}`).join('\n'));
  process.exit(1);
}

console.log(`check:tests ok — ${collectedPerHalf.join(', ')} files collected, none orphaned.`);
