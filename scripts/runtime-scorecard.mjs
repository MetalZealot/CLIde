#!/usr/bin/env node
/**
 * Runtime scorecard: how Claude chat turns are performing on this host, read
 * from the production service's `[turn]` log lines, plus the `claude` processes
 * alive right now and the memory left. Read-only.
 *
 *   node scripts/runtime-scorecard.mjs [--since "7 days ago"] [--turns 15] [--unit cloudcli]
 *
 * "Run start" is when the runtime began the turn; both timings are measured
 * from it. Old log lines key a new chat's `start` as `session=new`; those are
 * paired with the next first frame of a session that has no open turn.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SINCE = arg('since', '30 days ago');
const SHOW = Number(arg('turns', '15'));
const UNIT = arg('unit', 'cloudcli');

function readTurnLines() {
  let out = '';
  try {
    out = execFileSync('journalctl', ['--user-unit', UNIT, '--since', SINCE, '--no-pager', '-o', 'short-unix'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`journalctl failed: ${error.message.split('\n')[0]}`);
  }
  return out.split('\n').filter((line) => line.includes('[turn] '));
}

function parseTurns(lines) {
  const open = new Map();
  const pendingNew = [];
  const turns = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)(?:\.\d+)? .*\[turn\] (\S+) session=(\S+)(.*)$/);
    if (!m) continue;
    const [, ts, event, session, rest] = m;
    const f = Object.fromEntries([...rest.matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
    if (event === 'start') {
      const turn = { at: Number(ts), session, model: f.model, effort: f.effort, resume: f.resume };
      if (session === 'new') pendingNew.push(turn);
      else open.set(session, turn);
      turns.push(turn);
      continue;
    }
    let turn = open.get(session);
    if (!turn && event === 'first-frame' && pendingNew.length > 0) {
      turn = pendingNew.shift();
      turn.session = session;
      open.set(session, turn);
    }
    if (!turn) continue;
    if (event === 'first-frame') {
      turn.firstFrame = Number(f.ms);
      if (f.ready_ms) turn.ready = Number(f.ready_ms);
    }
    if (event === 'result' || event === 'error-result') {
      turn.result = Number(f.ms);
      turn.error = event === 'error-result';
      if (f.request_ms) turn.request = Number(f.request_ms);
      if (f.ttft_ms) turn.ttft = Number(f.ttft_ms);
    }
    if (event === 'end' || event === 'failed') {
      turn.end = Number(f.ms);
      turn.frames = Number(f.frames);
      turn.dropped = f.dropped;
      turn.failed = event === 'failed';
      turn.aborted = f.aborted === 'yes';
      open.delete(session);
    }
  }
  return turns;
}

const pct = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
};
const sec = (ms) => (ms == null || Number.isNaN(ms) ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pad = (v, n) => String(v).padEnd(n);

function summaryRow(label, values) {
  return `  ${pad(label, 34)} n=${pad(values.length, 5)} p50 ${pad(sec(pct(values, 0.5)), 7)} p90 ${pad(sec(pct(values, 0.9)), 7)} max ${sec(values.length ? Math.max(...values) : null)}`;
}

function memOf(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return { rss: kb('Rss'), pss: kb('Pss'), uss: kb('Private_Clean') + kb('Private_Dirty'), swap: kb('Swap') };
  } catch {
    return null;
  }
}

function claudeProcesses() {
  const rows = [];
  for (const dir of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue;
    let cmd = '';
    let stat = '';
    try {
      cmd = fs.readFileSync(`/proc/${dir}/cmdline`, 'utf8').split('\0').filter(Boolean);
      stat = fs.readFileSync(`/proc/${dir}/stat`, 'utf8');
    } catch {
      continue;
    }
    const exe = cmd[0] ?? '';
    if (!/(^|\/)claude$/.test(exe)) continue;
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    let parent = '';
    try {
      parent = fs.readFileSync(`/proc/${ppid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    } catch {
      /* parent gone */
    }
    const owner = parent.includes('dist-server/server/index.js')
      ? 'CLIde chat'
      : cmd.includes('--output-format')
        ? 'SDK (other host)'
        : 'terminal';
    rows.push({ pid: Number(dir), owner, mem: memOf(dir), args: cmd.slice(1).join(' ').slice(0, 60) });
  }
  return rows.sort((a, b) => (b.mem?.pss ?? 0) - (a.mem?.pss ?? 0));
}

function meminfo() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const kb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
  return { available: kb('MemAvailable'), total: kb('MemTotal'), swapUsed: kb('SwapTotal') - kb('SwapFree') };
}

const mb = (kb) => `${Math.round(kb / 1024)} MB`;

const turns = parseTurns(readTurnLines());
const done = turns.filter((t) => t.firstFrame != null);
console.log(`Claude chat turns since ${SINCE}: ${turns.length} started, ${done.length} reached a first frame`);
if (turns.length > 0) {
  console.log(`  ${new Date(turns[0].at * 1000).toISOString()} → ${new Date(turns.at(-1).at * 1000).toISOString()}`);
}
console.log('\nPer turn, most recent last (times from run start)');
console.log(`  ${pad('when (UTC)', 17)} ${pad('session', 9)} ${pad('model', 7)} ${pad('resume', 6)} ${pad('→frame', 7)} ${pad('→result', 8)} ${pad('frames', 6)} dropped`);
for (const t of turns.slice(-SHOW)) {
  const flag = t.failed ? ' FAILED' : t.aborted ? ' aborted' : t.error ? ' error' : '';
  console.log(
    `  ${pad(new Date(t.at * 1000).toISOString().slice(5, 19).replace('T', ' '), 17)} ${pad(t.session.slice(0, 8), 9)} ${pad(t.model ?? '—', 7)} ${pad(t.resume ?? '—', 6)} ${pad(sec(t.firstFrame), 7)} ${pad(sec(t.result), 8)} ${pad(t.frames ?? '—', 6)} ${t.dropped ?? ''}${flag}`,
  );
}

console.log('\nSummary');
console.log(summaryRow('run start → first frame, resumed', done.filter((t) => t.resume === 'yes').map((t) => t.firstFrame)));
console.log(summaryRow('run start → first frame, new chat', done.filter((t) => t.resume === 'no').map((t) => t.firstFrame)));
console.log(summaryRow('run start → result', turns.filter((t) => t.result != null).map((t) => t.result)));
// Logged from the CLI's own timing since phase 1; older turns lack them.
console.log(summaryRow('spawn → input ready (CLI)', turns.filter((t) => t.ready != null).map((t) => t.ready)));
console.log(summaryRow('turn → request sent (CLI)', turns.filter((t) => t.request != null).map((t) => t.request)));
console.log(summaryRow('request → first token (CLI)', turns.filter((t) => t.ttft != null).map((t) => t.ttft)));
const failed = turns.filter((t) => t.failed).length;
const errors = turns.filter((t) => t.error).length;
console.log(`  failed runs ${failed}, error results ${errors}, aborted ${turns.filter((t) => t.aborted).length}`);
const droppedTotals = new Map();
for (const t of turns) {
  for (const part of (t.dropped ?? '').split(',').filter(Boolean)) {
    const [kind, count] = part.split(':');
    droppedTotals.set(kind, (droppedTotals.get(kind) ?? 0) + Number(count));
  }
}
const logged = turns.filter((t) => t.dropped !== undefined || t.end != null).length;
console.log(
  `  dropped SDK frames: ${droppedTotals.size ? [...droppedTotals].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') : 'none logged yet'} (${logged} ended turns)`,
);

console.log('\nLive claude processes (PSS = fair share of shared pages; USS = what closing it frees)');
const procs = claudeProcesses();
if (procs.length === 0) console.log('  none');
for (const p of procs) {
  console.log(`  ${pad(p.pid, 8)} ${pad(p.owner, 17)} RSS ${pad(p.mem ? mb(p.mem.rss) : '—', 7)} PSS ${pad(p.mem ? mb(p.mem.pss) : '—', 7)} USS ${pad(p.mem ? mb(p.mem.uss) : '—', 7)} swap ${pad(p.mem ? mb(p.mem.swap) : '—', 7)} ${p.args}`);
}
const m = meminfo();
console.log(`\nMemory: ${mb(m.available)} available of ${mb(m.total)}; swap used ${mb(m.swapUsed)}`);
