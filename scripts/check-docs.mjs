#!/usr/bin/env node
// Keeps docs/ cheap to read.
//
// Long-form design documents are read far more often than they are written —
// every session that touches their subject pays for them again, and a document
// nobody can afford to re-read stops being updated. So size is a correctness
// property here, not a style preference. This enforces it.
//
// Run: npm run check:docs [-- <paths>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Byte caps per document type. Bytes track token cost better than lines do —
 *  docs/TODO.md was once 77 KB across 143 lines. */
const CAPS = [
  { dir: 'docs/plans', cap: 16_000, type: 'plan' },
  { dir: 'docs', cap: 24_000, type: 'reference', flat: true },
  { dir: 'docs/decisions', cap: 10_000, type: 'ADR' },
  // Read whole by every session working its plan; stable, so read rarely otherwise.
  { dir: 'docs/designs', cap: 32_000, type: 'design' },
];

// docs/TODO.md is deliberately uncapped: the backlog's size is the amount of queued
// work, so only its items are capped (below).
const UNCAPPED = new Set(['docs/TODO.md']);

/** The only folders under docs/. Anything else is an archive or a fifth type;
 *  finished work is deleted and git keeps it. */
const DOC_FOLDERS = new Set(['decisions', 'designs', 'plans']);
const FILE_CAPS = [
  // AGENTS.md is imported into every session, so this is a per-session read
  // budget (~4K tokens), not a style rule. Raised from 13K once, for the comment
  // rules; a further rise needs a section routed into docs/ instead.
  { file: 'AGENTS.md', cap: 15_000 },
  // The architecture overview: shape, code map, invariants and quality goals only.
  { file: 'ARCHITECTURE.md', cap: 24_000 },
];

/** Sections that exist to introduce a document rather than to say anything.
 *  Each one was load-bearing in the pile this replaced: specs routinely opened
 *  with Status, Purpose, Executive summary and Scope restating each other
 *  before any content. */
const BANNED_HEADINGS = [
  [/^#+\s*how to read this document/i, 'a document that needs reading instructions is too long'],
  [/^#+\s*executive (summary|decision)/i, 'put the decision in an ADR and the rest in the body'],
  [/^#+\s*purpose\s*$/i, 'the title and first sentence are the purpose'],
  [/^#+\s*(overview|background)\s*$/i, 'state the current position instead of recapping'],
  [/^#+\s*scope\s*$/i, 'say what is out of scope only if someone would otherwise assume it in'],
  [/^#+\s*open questions/i, 'an open question is a TODO item, not a document section'],
  [/^#+\s*verification (plan|checklist)/i, 'use one "Done when" list; AGENTS.md owns how to verify'],
  [/^#+\s*(automated|client|backend) coverage/i, 'fold into "Done when"'],
  [/^#+\s*(corrections applied|re-measurement|claim verification)/i,
    'edit the document to match reality instead of appending an audit'],
];

/** A plan must say where it is without being read. */
const STATUS_LINE = /^- Status: (not started|\d+\/\d+|complete|blocked\b.*)$/m;
const NEXT_LINE = /^- Next: \S/m;

/** A design and its plan name each other: the plan's `- Design:` line is how a
 *  session working one phase learns the design binds it. */
const DESIGN_STATUS_LINE = /^- Status: (draft|agreed \d{4}-\d{2}-\d{2}|superseded by \S.*)$/m;
const PLAN_LINK = /^- Plan: .*\]\(\.\.\/plans\/([\w.-]+\.md)\)/m;
const DESIGN_LINK = /^- Design: .*\]\(\.\.\/designs\/([\w.-]+\.md)\)/m;

const MAX_TODO_LINE = 400;

/** Known over-cap files, each with a reason and an owning TODO item. An entry here
 *  is a debt that has been looked at and scheduled — not a way to make the check
 *  quiet. Adding one without a TODO item defeats the point of the check. */
const SIZE_EXCEPTIONS = {
  'docs/plans/agent-runtime-rebuild.md':
    "Grayson's call: the priority plan keeps its detail over the cap; delete it when done — see docs/TODO.md",
};

const problems = [];
const fail = (file, msg) => problems.push({ file, msg });

function walk(dir, flat = false) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!flat) out.push(...walk(rel));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function checkHeadings(file, text) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!line.startsWith('#')) return;
    for (const [pattern, why] of BANNED_HEADINGS) {
      if (pattern.test(line)) fail(file, `${i + 1}: ceremony section "${line.trim()}" — ${why}`);
    }
  });
}

function checkSize(file, text, cap, type) {
  const size = Buffer.byteLength(text);
  if (size > cap && SIZE_EXCEPTIONS[file]) {
    console.warn(`  note: ${file} is ${(size / 1000).toFixed(1)} KB over the ${(cap / 1000).toFixed(0)} KB ${type} cap — ${SIZE_EXCEPTIONS[file]}`);
    return;
  }
  if (size > cap) {
    fail(file, `${(size / 1000).toFixed(1)} KB exceeds the ${(cap / 1000).toFixed(0)} KB ${type} cap — split it, cut the background, or route to a reference doc`);
  }
}

for (const { dir, cap, type, flat } of CAPS) {
  for (const file of walk(dir, flat)) {
    if (file.endsWith('/README.md') || UNCAPPED.has(file)) continue;
    const text = readFileSync(join(ROOT, file), 'utf8');
    checkSize(file, text, cap, type);
    checkHeadings(file, text);
    if (type === 'plan') {
      if (!STATUS_LINE.test(text)) {
        fail(file, 'no machine-readable status — needs a "- Status: not started | N/M | complete | blocked <why>" line');
      }
      if (!NEXT_LINE.test(text)) {
        fail(file, 'no "- Next: <the next concrete action>" line');
      }
      const design = text.match(DESIGN_LINK)?.[1];
      if (design && !existsSync(join(ROOT, 'docs/designs', design))) {
        fail(file, `its "- Design:" line points at docs/designs/${design}, which does not exist`);
      }
    }
    if (type === 'design') {
      if (!DESIGN_STATUS_LINE.test(text)) {
        fail(file, 'no "- Status: draft | agreed <YYYY-MM-DD> | superseded by <link>" line');
      }
      const plan = text.match(PLAN_LINK)?.[1];
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (!plan) {
        fail(file, 'no "- Plan: [<title>](../plans/<file>.md)" line');
      } else if (!existsSync(join(ROOT, 'docs/plans', plan))) {
        fail(file, `its plan docs/plans/${plan} does not exist`);
      } else if (readFileSync(join(ROOT, 'docs/plans', plan), 'utf8').match(DESIGN_LINK)?.[1] !== name) {
        fail(file, `docs/plans/${plan} has no "- Design:" line linking back to ../designs/${name}`);
      }
    }
  }
}

for (const { file, cap } of FILE_CAPS) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  checkSize(file, text, cap, 'file');
}

// docs/TODO.md is read at the start of every session, so a single essay-length
// item taxes work that has nothing to do with it. Items point; they do not explain.
try {
  const todo = readFileSync(join(ROOT, 'docs/TODO.md'), 'utf8');
  todo.split('\n').forEach((line, i) => {
    if (line.length > MAX_TODO_LINE) {
      fail('docs/TODO.md', `${i + 1}: item is ${line.length} chars (max ${MAX_TODO_LINE}) — link the plan, ADR, or commit instead of restating it`);
    }
  });
} catch {
  /* absent is fine */
}

for (const entry of readdirSync(join(ROOT, 'docs'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!DOC_FOLDERS.has(entry.name)) {
    fail(`docs/${entry.name}`, 'not a document type — reference docs sit in docs/ itself, and finished work is deleted, not archived');
    continue;
  }
  for (const nested of readdirSync(join(ROOT, 'docs', entry.name), { withFileTypes: true })) {
    if (nested.isDirectory()) fail(`docs/${entry.name}/${nested.name}`, 'docs/ folders are flat; finished work is deleted, not archived');
  }
}

if (problems.length) {
  console.error(`\ndocs check failed — ${problems.length} problem(s):\n`);
  for (const { file, msg } of problems) console.error(`  ${file}: ${msg}`);
  console.error('\nRules and rationale: docs/plans/README.md, docs/designs/README.md\n');
  process.exit(1);
}

console.log('docs check passed');
