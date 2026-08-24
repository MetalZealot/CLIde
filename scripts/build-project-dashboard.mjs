#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT = join(DEFAULT_ROOT, '.generated', 'project-dashboard.html');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function plainMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceHref(sourcePath) {
  return `../${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
}

function metadataValue(markdown, key) {
  const lines = markdown.split('\n');
  const prefix = `- ${key}:`;
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start === -1) return '';

  const parts = [lines[start].slice(prefix.length).trim()];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!/^\s{2,}\S/.test(lines[index])) break;
    parts.push(lines[index].trim());
  }
  return plainMarkdown(parts.join(' '));
}

export function parsePlan(markdown, sourcePath) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1];
  const status = metadataValue(markdown, 'Status');
  const next = metadataValue(markdown, 'Next');
  if (!title || !status || !next) {
    throw new Error(`${sourcePath} needs a title, Status, and Next field`);
  }

  const progressMatch = status.match(/^(\d+)\/(\d+)$/);
  return {
    title: plainMarkdown(title),
    status,
    next,
    sourcePath,
    progress: progressMatch
      ? { complete: Number(progressMatch[1]), total: Number(progressMatch[2]) }
      : null,
  };
}

export function parsePlanOrder(markdown) {
  const paths = [];
  for (const line of markdown.split('\n')) {
    const match = line.match(/^\|\s*\[[^\]]+\]\(([^)]+\.md)\)\s*\|/);
    if (match) paths.push(posix.normalize(`docs/plans/${match[1]}`));
  }
  return paths;
}

function todoSize(line) {
  const labels = [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1].trim());
  const size = labels.reverse().find((label) => /^(?:XS|S|M|L|\?)(?:\/(?:S|M|L|\?))?(?:\s|$|—)/.test(label));
  if (!size || size.includes('?')) return '?';
  if (size.includes('L')) return 'L';
  if (size.includes('M')) return 'M';
  return 'S';
}

export function parseTodo(markdown) {
  const categories = [];
  const sizes = { S: 0, M: 0, L: 0, '?': 0 };
  let category = null;

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      category = { name: plainMarkdown(heading[1]), open: 0, partial: 0 };
      categories.push(category);
      continue;
    }

    const item = line.match(/^- \[([ ~x])\]\s+/);
    if (!item || item[1] === 'x' || !category) continue;
    if (item[1] === '~') category.partial += 1;
    else category.open += 1;
    sizes[todoSize(line)] += 1;
  }

  const populated = categories.filter(({ open, partial }) => open + partial > 0);
  return {
    sourcePath: 'docs/TODO.md',
    open: populated.reduce((sum, item) => sum + item.open, 0),
    partial: populated.reduce((sum, item) => sum + item.partial, 0),
    categories: populated,
    sizes,
  };
}

function markdownCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMapsIndex(markdown) {
  const maps = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const [document, role, status] = markdownCells(line);
    const link = document?.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!link || !role || !status) continue;
    maps.push({
      name: plainMarkdown(link[1]),
      role: plainMarkdown(role),
      status: plainMarkdown(status),
      sourcePath: posix.normalize(`docs/maps/${link[2]}`),
    });
  }
  return maps;
}

export function parseAdr(markdown, sourcePath) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1];
  const date = metadataValue(markdown, 'Date');
  const status = metadataValue(markdown, 'Status');
  if (!title || !date || !status) {
    throw new Error(`${sourcePath} needs a title, Date, and Status field`);
  }
  return { title: plainMarkdown(title), date, status, sourcePath };
}

export function collectDashboardData(root = DEFAULT_ROOT) {
  const read = (sourcePath) => readFileSync(join(root, sourcePath), 'utf8');
  const plansDir = join(root, 'docs', 'plans');
  const plans = readdirSync(plansDir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => parsePlan(read(`docs/plans/${name}`), `docs/plans/${name}`));

  const order = parsePlanOrder(read('docs/plans/README.md'));
  const priority = new Map(order.map((sourcePath, index) => [sourcePath, index]));
  plans.sort((left, right) => {
    const leftOrder = priority.get(left.sourcePath) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = priority.get(right.sourcePath) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.title.localeCompare(right.title);
  });

  const decisionsDir = join(root, 'docs', 'decisions');
  const decisions = readdirSync(decisionsDir)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((name) => parseAdr(read(`docs/decisions/${name}`), `docs/decisions/${name}`))
    .sort((left, right) => right.date.localeCompare(left.date) || right.sourcePath.localeCompare(left.sourcePath))
    .slice(0, 5);

  return {
    plans,
    todo: parseTodo(read('docs/TODO.md')),
    maps: parseMapsIndex(read('docs/maps/README.md')),
    decisions,
  };
}

function planStatus(plan) {
  if (plan.progress) return { label: 'In progress', className: 'progress' };
  if (plan.status.startsWith('blocked')) return { label: 'Blocked', className: 'blocked' };
  if (plan.status === 'complete') return { label: 'Complete', className: 'complete' };
  return { label: 'Ready', className: 'ready' };
}

function renderPlan(plan) {
  const status = planStatus(plan);
  const progress = plan.progress
    ? `<div class="progress-row"><progress value="${plan.progress.complete}" max="${plan.progress.total}" aria-label="${plan.progress.complete} of ${plan.progress.total} phases complete"></progress><span>${plan.progress.complete}/${plan.progress.total}</span></div>`
    : '';

  return `<article class="card plan-card">
  <div class="card-heading">
    <h3>${escapeHtml(plan.title)}</h3>
    <span class="badge ${status.className}">${status.label}</span>
  </div>
  ${progress}
  <p class="eyebrow">Next</p>
  <p class="next-action">${escapeHtml(plan.next)}</p>
  <a class="source-link" href="${sourceHref(plan.sourcePath)}">Open plan <span aria-hidden="true">→</span></a>
</article>`;
}

function renderBacklog(todo) {
  const categoryRows = todo.categories
    .map(({ name, open, partial }) => `<li>
      <span>${escapeHtml(name)}</span>
      <span class="category-counts"><strong>${open + partial}</strong><small>${partial ? `${partial} active` : 'open'}</small></span>
    </li>`)
    .join('\n');
  const sizeCards = Object.entries(todo.sizes)
    .map(([size, count]) => `<div class="size-stat"><strong>${count}</strong><span>${escapeHtml(size)}</span></div>`)
    .join('');

  return `<div class="backlog-layout">
  <article class="card backlog-summary">
    <p class="eyebrow">Work items</p>
    <div class="large-stats">
      <div><strong>${todo.open}</strong><span>Open</span></div>
      <div><strong>${todo.partial}</strong><span>In progress</span></div>
    </div>
    <p class="eyebrow">Estimated size</p>
    <div class="size-grid">${sizeCards}</div>
  </article>
  <article class="card category-card">
    <div class="card-heading"><h3>By area</h3><span class="muted">${todo.open + todo.partial} total</span></div>
    <ul class="category-list">${categoryRows}</ul>
  </article>
</div>`;
}

function renderMaps(maps) {
  return maps.map((map) => `<article class="reference-row">
  <div>
    <h3><a href="${sourceHref(map.sourcePath)}">${escapeHtml(map.name)}</a></h3>
    <p>${escapeHtml(map.role)}</p>
  </div>
  <p class="freshness">${escapeHtml(map.status)}</p>
</article>`).join('\n');
}

function renderDecisions(decisions) {
  return decisions.map((decision) => `<li>
  <time datetime="${escapeHtml(decision.date)}">${escapeHtml(decision.date)}</time>
  <a href="${sourceHref(decision.sourcePath)}">${escapeHtml(decision.title)}</a>
  <span class="badge neutral">${escapeHtml(decision.status)}</span>
</li>`).join('\n');
}

export function renderDashboard(data) {
  const activePlans = data.plans.filter((plan) => plan.status !== 'complete');
  const inProgress = activePlans.filter((plan) => plan.progress).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>CLIde project dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f3f5f8;
      --surface: #ffffff;
      --surface-subtle: #f8fafc;
      --text: #172033;
      --muted: #647084;
      --border: #dfe4ec;
      --accent: #356ae6;
      --accent-soft: #e9efff;
      --green: #1f7a4d;
      --green-soft: #e7f5ed;
      --amber: #93621c;
      --amber-soft: #fff3da;
      --red: #a43f48;
      --red-soft: #fdebed;
      --shadow: 0 10px 30px rgba(21, 31, 50, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1119;
        --surface: #151b25;
        --surface-subtle: #101620;
        --text: #edf1f7;
        --muted: #98a3b5;
        --border: #2a3342;
        --accent: #83a6ff;
        --accent-soft: #1d315f;
        --green: #75d5a3;
        --green-soft: #163827;
        --amber: #f0c16d;
        --amber-soft: #3c2d13;
        --red: #f39aa2;
        --red-soft: #432126;
        --shadow: none;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    a { color: var(--accent); text-underline-offset: 3px; }
    a:hover { text-decoration-thickness: 2px; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0 40px; }
    header { display: flex; justify-content: space-between; gap: 32px; align-items: end; margin-bottom: 42px; }
    .kicker, .eyebrow { margin: 0; color: var(--muted); font-size: 0.72rem; font-weight: 750; letter-spacing: 0.1em; text-transform: uppercase; }
    h1 { margin: 6px 0 8px; font-size: clamp(2rem, 6vw, 3.7rem); line-height: 1; letter-spacing: -0.045em; }
    .intro { max-width: 640px; margin: 0; color: var(--muted); font-size: 1.02rem; }
    .headline-stat { min-width: 180px; padding: 18px 20px; border-left: 3px solid var(--accent); background: var(--surface); box-shadow: var(--shadow); }
    .headline-stat strong { display: block; font-size: 1.7rem; line-height: 1; }
    .headline-stat span { color: var(--muted); font-size: 0.82rem; }
    section { margin-top: 44px; }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 14px; }
    .section-heading h2 { margin: 0; font-size: 1.35rem; letter-spacing: -0.02em; }
    .section-heading p { margin: 0; color: var(--muted); font-size: 0.88rem; }
    .plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .card { border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); }
    .plan-card { display: flex; min-height: 220px; flex-direction: column; padding: 22px; }
    .card-heading { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    .card-heading h3 { margin: 0; font-size: 1rem; line-height: 1.3; }
    .badge { flex: none; border-radius: 999px; padding: 4px 9px; font-size: 0.7rem; font-weight: 750; white-space: nowrap; }
    .badge.progress { color: var(--amber); background: var(--amber-soft); }
    .badge.ready { color: var(--accent); background: var(--accent-soft); }
    .badge.blocked { color: var(--red); background: var(--red-soft); }
    .badge.complete { color: var(--green); background: var(--green-soft); }
    .badge.neutral { color: var(--muted); background: var(--surface-subtle); border: 1px solid var(--border); }
    .progress-row { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
    progress { width: 120px; height: 7px; border: 0; border-radius: 99px; background: var(--border); accent-color: var(--accent); }
    progress::-webkit-progress-bar { border-radius: 99px; background: var(--border); }
    progress::-webkit-progress-value { border-radius: 99px; background: var(--accent); }
    progress::-moz-progress-bar { border-radius: 99px; background: var(--accent); }
    .plan-card .eyebrow { margin-top: auto; padding-top: 24px; }
    .next-action { margin: 5px 0 18px; color: var(--muted); font-size: 0.9rem; }
    .source-link { width: fit-content; font-size: 0.82rem; font-weight: 700; text-decoration: none; }
    .backlog-layout { display: grid; grid-template-columns: minmax(280px, 0.75fr) minmax(0, 1.25fr); gap: 14px; }
    .backlog-summary, .category-card { padding: 22px; }
    .large-stats { display: grid; grid-template-columns: 1fr 1fr; margin: 8px 0 24px; }
    .large-stats div + div { border-left: 1px solid var(--border); padding-left: 22px; }
    .large-stats strong { display: block; font-size: 2.1rem; line-height: 1.1; }
    .large-stats span, .size-stat span { color: var(--muted); font-size: 0.8rem; }
    .size-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 9px; }
    .size-stat { padding: 10px; background: var(--surface-subtle); text-align: center; }
    .size-stat strong, .size-stat span { display: block; }
    .category-list { margin: 17px 0 0; padding: 0; list-style: none; }
    .category-list li { display: flex; justify-content: space-between; gap: 18px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 0.88rem; }
    .category-counts { display: flex; gap: 8px; align-items: baseline; }
    .category-counts small, .muted { color: var(--muted); font-size: 0.75rem; }
    .reference-list { border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); }
    .reference-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 0.55fr); gap: 28px; padding: 18px 20px; }
    .reference-row + .reference-row { border-top: 1px solid var(--border); }
    .reference-row h3 { margin: 0 0 4px; font-size: 0.95rem; }
    .reference-row h3 a { color: var(--text); }
    .reference-row p { margin: 0; color: var(--muted); font-size: 0.82rem; }
    .reference-row .freshness { align-self: center; }
    .decision-list { margin: 0; padding: 0; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); list-style: none; }
    .decision-list li { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 15px 20px; }
    .decision-list li + li { border-top: 1px solid var(--border); }
    .decision-list time { color: var(--muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
    .decision-list a { color: var(--text); font-size: 0.9rem; font-weight: 650; }
    footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.78rem; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    @media (max-width: 720px) {
      .shell { width: min(100% - 24px, 620px); padding-top: 32px; }
      header { display: block; margin-bottom: 34px; }
      .headline-stat { margin-top: 24px; }
      .plan-grid, .backlog-layout { grid-template-columns: 1fr; }
      .section-heading { display: block; }
      .section-heading p { margin-top: 4px; }
      .reference-row { grid-template-columns: 1fr; gap: 8px; }
      .decision-list li { grid-template-columns: 1fr auto; gap: 6px 12px; }
      .decision-list time { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <p class="kicker">CLIde · Project state</p>
        <h1>What’s moving.</h1>
        <p class="intro">A read-only view of the Markdown that runs the project. Edit the source documents; regenerate this page.</p>
      </div>
      <div class="headline-stat"><strong>${inProgress}</strong><span>plan${inProgress === 1 ? '' : 's'} in progress</span></div>
    </header>

    <section aria-labelledby="active-work-title">
      <div class="section-heading">
        <h2 id="active-work-title">Active work</h2>
        <p>${activePlans.length} current plans · source order preserved</p>
      </div>
      <div class="plan-grid">${activePlans.map(renderPlan).join('\n')}</div>
    </section>

    <section aria-labelledby="backlog-title">
      <div class="section-heading">
        <h2 id="backlog-title">Backlog</h2>
        <p><a href="${sourceHref(data.todo.sourcePath)}">Open TODO <span aria-hidden="true">→</span></a></p>
      </div>
      ${renderBacklog(data.todo)}
    </section>

    <section aria-labelledby="reference-title">
      <div class="section-heading">
        <h2 id="reference-title">Current reference</h2>
        <p>${data.maps.length} living maps</p>
      </div>
      <div class="reference-list">${renderMaps(data.maps)}</div>
    </section>

    <section aria-labelledby="decisions-title">
      <div class="section-heading">
        <h2 id="decisions-title">Recent decisions</h2>
        <p>Five newest ADRs</p>
      </div>
      <ol class="decision-list">${renderDecisions(data.decisions)}</ol>
    </section>

    <footer>Markdown remains authoritative. Run <code>npm run docs:dashboard</code> to refresh this local view.</footer>
  </main>
</body>
</html>
`;
}

export function buildDashboard({ root = DEFAULT_ROOT, output = DEFAULT_OUTPUT } = {}) {
  const html = renderDashboard(collectDashboardData(root));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  return output;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const output = buildDashboard();
  console.log(`Project dashboard generated: ${relative(DEFAULT_ROOT, output)}`);
}
