/**
 * Live probe of a long-lived Agent SDK session: the phase-0 checks of the agent
 * runtime rebuild plan. Run from the repo root, one probe per invocation, and
 * check `free -h` between them; each spawns its own `claude` and costs a few
 * short turns on the user's Claude login:
 *
 *   npx tsx scripts/verify-claude-session-sdk.ts <1-13>
 *   npx tsx scripts/verify-claude-session-sdk.ts cleanup   # filesystem only
 *
 *    1  three turns on one query: timing, cost totals, delivery receipt
 *    2  setPermissionMode / setModel mid-turn
 *    3  interrupt mid-turn: still_queued, canUseTool's signal, background task,
 *       with and without perTaskStopAffordance
 *    4  AskUserQuestion in auto and bypass, with and without a PreToolUse hook
 *    5  setPermissionMode('bypassPermissions') on a default session, with and
 *       without allowDangerouslySkipPermissions
 *    6  what applyFlagSettings({effortLevel: null}) and ({model: null}) reset to
 *    7  whether an error result ends the iterator
 *    8  session_state_changed, tool_use_summary, session_title_changed
 *    9  Options.sessionId names the transcript
 *   10  supportedCommands / initializationResult from an idle query
 *   11  a background task waking a turn after result on an open input
 *   12  the SDK's own stdin hold after the input closes
 *   13  resident memory: three idle sessions, a resumed large one, mid-turn
 *
 * Sessions run in a throwaway cwd, so their transcripts land under
 * ~/.claude/projects/-tmp-clide-session-probe and CLIde's watcher indexes them:
 * after the last probe run `cleanup`, then delete the database rows it lists.
 * Sanitized frame streams go to the fixtures directory, one file per session.
 * Findings are in the trailing FINDINGS block.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query, type Options, type PermissionResult, type Query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeExecutablePath } from '../server/shared/claude-cli-path.js';

const SCRATCH = '/tmp/clide-session-probe';
const REPO = process.cwd();
const FIXTURES = path.join(REPO, 'server/modules/providers/tests/fixtures/claude-session-sdk');
const LEDGER = '/tmp/clide-session-probe-ledger.json';
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const CHEAP = process.env.PROBE_MODEL || 'haiku';
const PROJECT_DIR = path.join(CLAUDE_HOME, 'projects', SCRATCH.replace(/[^a-zA-Z0-9]/g, '-'));

/* ------------------------------ host readings ----------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function memAvailableMB(): number {
  const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
  return m ? Math.round(Number(m[1]) / 1024) : -1;
}

function parentOf(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return null;
  }
}

function allPids(): number[] {
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number);
}

function childrenOf(pid: number): number[] {
  return allPids().filter((p) => parentOf(p) === pid);
}

function treeOf(pid: number): number[] {
  const out = [pid];
  for (let i = 0; i < out.length; i++) out.push(...childrenOf(out[i]));
  return out;
}

function cmdline(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

type Mem = { procs: number; rssMB: number; pssMB: number; ussMB: number; swapMB: number };

/** PSS is the fair share of pages shared with other `claude` processes; USS is what closing it frees. */
function treeMem(pid: number | null): Mem | null {
  if (!pid) return null;
  const total = { procs: 0, rss: 0, pss: 0, uss: 0, swap: 0 };
  for (const p of treeOf(pid)) {
    let text = '';
    try {
      text = fs.readFileSync(`/proc/${p}/smaps_rollup`, 'utf8');
    } catch {
      continue;
    }
    const kb = (k: string) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    total.procs += 1;
    total.rss += kb('Rss');
    total.pss += kb('Pss');
    total.uss += kb('Private_Clean') + kb('Private_Dirty');
    total.swap += kb('Swap');
  }
  const mb = (k: number) => Math.round(k / 1024);
  return { procs: total.procs, rssMB: mb(total.rss), pssMB: mb(total.pss), ussMB: mb(total.uss), swapMB: mb(total.swap) };
}

/** Read-only: processes whose command line contains `needle`. */
function pidsMatching(needle: string): number[] {
  return allPids().filter((p) => p !== process.pid && cmdline(p).includes(needle));
}

function killIfMatches(pid: number, needle: string) {
  if (cmdline(pid).includes(needle)) process.kill(pid, 'SIGTERM');
}

/* ------------------------------- sanitizing ------------------------------- */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const REDACT_KEYS = new Set(['email', 'emailAddress', 'organization', 'organizationName', 'orgName', 'organizationUuid', 'accountUuid', 'signature']);

function makeSanitizer() {
  const ids = new Map<string, string>();
  const scrubString = (s: string) => {
    let out = s.split(SCRATCH).join('<scratch>').split(os.homedir()).join('~');
    out = out.replace(UUID_RE, (u) => {
      const k = u.toLowerCase();
      if (!ids.has(k)) ids.set(k, `<uuid:${ids.size + 1}>`);
      return ids.get(k)!;
    });
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>');
    return out.length > 4000 ? `${out.slice(0, 4000)}…<truncated ${out.length} chars>` : out;
  };
  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[k] = REDACT_KEYS.has(k) ? '<redacted>' : scrub(val);
      return o;
    }
    return v;
  };
  return scrub;
}

/* -------------------------------- session -------------------------------- */

type Frame = { t: number; m: any };
type Action = { t: number; action: string; [k: string]: unknown };
type Handler = (tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<PermissionResult>;

const ledger: { sessionIds: string[] } = fs.existsSync(LEDGER)
  ? JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
  : { sessionIds: [] };
function remember(id: string) {
  if (!ledger.sessionIds.includes(id)) {
    ledger.sessionIds.push(id);
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }
}

function probeEnv(extra: Record<string, string>): Record<string, string> {
  // Production runs under systemd with no CLAUDE_* variables; a probe launched
  // from a Claude session would otherwise inherit that session's.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^CLAUDE/.test(k)) env[k] = v;
  }
  return { ...env, CLAUDE_CODE_EMIT_STARTUP_TIMING: '1', ...extra };
}

const claimedPids = new Set<number>();

class ProbeSession {
  readonly t0 = Date.now();
  readonly frames: Frame[] = [];
  readonly actions: Action[] = [];
  readonly permissionCalls: { t: number; tool: string; input: Record<string, unknown>; abortedAt?: number }[] = [];
  readonly q: Query;
  readonly done: Promise<void>;
  error: string | null = null;
  endedAt: number | null = null;
  pid: number | null = null;
  onPermission: Handler = async (_tool, input) => ({ behavior: 'allow', updatedInput: input });
  private pending: any[] = [];
  private wake: (() => void) | null = null;
  private inputClosed = false;
  private listeners = new Set<() => boolean>();
  private readonly before = new Set(childrenOf(process.pid));

  constructor(readonly label: string, options: Partial<Options> = {}, env: Record<string, string> = {}) {
    this.q = query({
      prompt: this.stream(),
      options: {
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
        cwd: SCRATCH,
        model: CHEAP,
        permissionMode: 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        tools: { type: 'preset', preset: 'claude_code' },
        settingSources: ['project', 'user', 'local'],
        settings: { fastMode: false },
        ...options,
        env: probeEnv(env),
        canUseTool: (tool, input, opts) => {
          const call = { t: this.now(), tool, input };
          this.permissionCalls.push(call);
          this.act('canUseTool', { tool });
          opts.signal.addEventListener('abort', () => {
            (call as any).abortedAt = this.now();
          });
          return this.onPermission(tool, input, opts);
        },
      },
    });
    this.done = this.read();
  }

  now() {
    return Date.now() - this.t0;
  }

  log(text: string) {
    console.log(`  [${this.label} +${(this.now() / 1000).toFixed(1)}s] ${text}`);
  }

  act(action: string, fields: Record<string, unknown> = {}) {
    this.actions.push({ t: this.now(), action, ...fields });
  }

  private async *stream() {
    while (true) {
      while (this.pending.length > 0) yield this.pending.shift();
      if (this.inputClosed) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
    }
  }

  private notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
    for (const check of [...this.listeners]) check();
  }

  private async read() {
    try {
      for await (const m of this.q as AsyncIterable<any>) {
        this.frames.push({ t: this.now(), m });
        if (typeof m.session_id === 'string' && m.session_id) remember(m.session_id);
        this.notify();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.endedAt = this.now();
      this.notify();
    }
  }

  send(text: string, extra: { uuid?: string; priority?: 'now' | 'next' | 'later' } = {}): string {
    const uuid = extra.uuid ?? randomUUID();
    this.pending.push({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      uuid,
      ...(extra.priority ? { priority: extra.priority } : {}),
    });
    this.act('send', { uuid, text, priority: extra.priority });
    this.notify();
    return uuid;
  }

  closeInput() {
    this.inputClosed = true;
    this.act('closeInput');
    this.notify();
  }

  mark() {
    return this.frames.length;
  }

  waitFor(pred: (m: any) => boolean, from: number, timeoutMs: number): Promise<(Frame & { i: number }) | null> {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const check = () => {
        for (let i = from; i < this.frames.length; i++) {
          if (pred(this.frames[i].m)) {
            finish({ ...this.frames[i], i });
            return true;
          }
        }
        if (this.endedAt !== null) {
          finish(null);
          return true;
        }
        return false;
      };
      const finish = (v: (Frame & { i: number }) | null) => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve(v);
      };
      timer = setTimeout(() => finish(null), timeoutMs);
      if (!check()) this.listeners.add(check);
    });
  }

  async turn(text: string, timeoutMs = 120_000, extra: { priority?: 'now' | 'next' | 'later' } = {}) {
    const from = this.mark();
    const sentAt = this.now();
    const uuid = this.send(text, extra);
    const result = await this.waitFor((m) => m.type === 'result', from, timeoutMs);
    return { uuid, from, sentAt, result, to: result ? result.i + 1 : this.mark() };
  }

  /** Control call with its outcome and round trip recorded. */
  async control<T>(name: string, call: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
    const started = this.now();
    try {
      const value = await call();
      const out = { ok: true, ms: this.now() - started, value };
      this.act(`control:${name}`, { ok: true, ms: out.ms, value: value as unknown });
      return out;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.act(`control:${name}`, { ok: false, ms: this.now() - started, error });
      return { ok: false, ms: this.now() - started, error };
    }
  }

  async resolvePid(): Promise<number | null> {
    if (this.pid) return this.pid;
    for (let i = 0; i < 50 && !this.pid; i++) {
      const fresh = childrenOf(process.pid).filter((p) => !this.before.has(p) && !claimedPids.has(p) && cmdline(p).includes('claude'));
      if (fresh.length > 0) {
        this.pid = fresh[0];
        claimedPids.add(this.pid);
      } else {
        await sleep(100);
      }
    }
    return this.pid;
  }

  alive() {
    return this.pid !== null && cmdline(this.pid).includes('claude');
  }

  types(from = 0, to = this.frames.length): string[] {
    return this.frames.slice(from, to).map(({ m }) => frameKey(m));
  }

  async finish(waitMs = 15_000) {
    if (!this.inputClosed) this.closeInput();
    const closedAt = this.now();
    await Promise.race([this.done, sleep(waitMs)]);
    const exitedAfter = this.endedAt !== null ? this.endedAt - closedAt : null;
    if (this.endedAt === null) this.q.close();
    await sleep(300);
    this.save();
    return { exitedAfterMs: exitedAfter, processGone: !this.alive(), iteratorError: this.error };
  }

  save() {
    fs.mkdirSync(FIXTURES, { recursive: true });
    const scrub = makeSanitizer();
    const lines = [
      ...this.frames.map((f) => ({ t: f.t, frame: f.m })),
      ...this.actions.map(({ t, ...rest }) => ({ t, ...rest })),
    ].sort((a, b) => a.t - b.t);
    const file = path.join(FIXTURES, `${this.label}.ndjson`);
    fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(scrub(l))).join('\n')}\n`);
    console.log(`  fixture: ${path.relative(REPO, file)} (${lines.length} lines)`);
  }
}

function frameKey(m: any): string {
  if (!m || typeof m !== 'object') return String(m);
  if (m.type === 'system') return `system/${m.subtype}`;
  if (m.type === 'stream_event') return `stream_event/${m.event?.type}`;
  if (m.type === 'result') return `result/${m.subtype}${m.is_error ? '!' : ''}`;
  if (m.type === 'user' && m.isReplay) return 'user(replay)';
  if (m.type === 'assistant') {
    const blocks = (m.message?.content ?? []).map((b: any) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type));
    return `assistant[${blocks.join(',')}]`;
  }
  if (m.type === 'user') {
    const content = m.message?.content;
    const blocks = Array.isArray(content) ? content.map((b: any) => b.type) : ['text'];
    return `user[${blocks.join(',')}]`;
  }
  return m.subtype ? `${m.type}/${m.subtype}` : m.type;
}

function compact(keys: string[]): string {
  const out: string[] = [];
  for (const k of keys) {
    const last = out[out.length - 1];
    const m = last?.match(/^(.*) x(\d+)$/);
    if (last === k) out[out.length - 1] = `${k} x2`;
    else if (m && m[1] === k) out[out.length - 1] = `${k} x${Number(m[2]) + 1}`;
    else out.push(k);
  }
  return out.join(', ');
}

function texts(s: ProbeSession, from = 0, to = s.frames.length): string[] {
  const out: string[] = [];
  for (const { m } of s.frames.slice(from, to)) {
    if (m.type !== 'assistant') continue;
    for (const b of m.message?.content ?? []) if (b.type === 'text' && b.text) out.push(b.text.trim().slice(0, 80));
  }
  return out;
}

function toolResults(s: ProbeSession, from = 0, to = s.frames.length): string[] {
  const out: string[] = [];
  for (const { m } of s.frames.slice(from, to)) {
    if (m.type !== 'user' || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content) {
      if (b.type !== 'tool_result') continue;
      const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      out.push(`${b.is_error ? 'ERR ' : ''}${c.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  return out;
}

function show(label: string, value: unknown) {
  console.log(`  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

function turnSummary(s: ProbeSession, turn: Awaited<ReturnType<ProbeSession['turn']>>) {
  const frames = s.frames.slice(turn.from, turn.to);
  const at = (pred: (m: any) => boolean) => {
    const f = frames.find((x) => pred(x.m));
    return f ? f.t - turn.sentAt : null;
  };
  const r = turn.result?.m;
  const firstAssistant = frames.find((x) => x.m.type === 'assistant')?.m;
  return {
    firstFrameMs: frames[0] ? frames[0].t - turn.sentAt : null,
    initMs: at((m) => m.type === 'system' && m.subtype === 'init'),
    messageStartMs: at((m) => m.type === 'stream_event' && m.event?.type === 'message_start'),
    firstAssistantMs: at((m) => m.type === 'assistant'),
    resultMs: r ? turn.result!.t - turn.sentAt : null,
    subtype: r?.subtype,
    isError: r?.is_error,
    numTurns: r?.num_turns,
    durationMs: r?.duration_ms,
    durationApiMs: r?.duration_api_ms,
    ttftMs: r?.ttft_ms,
    timeToRequestMs: r?.time_to_request_ms,
    phases: r?.time_to_request_phases_ms,
    processTurnIndex: r?.process_turn_index,
    totalCostUsd: r?.total_cost_usd,
    outputTokens: r?.usage?.output_tokens,
    modelUsage: r?.modelUsage
      ? Object.fromEntries(Object.entries(r.modelUsage).map(([k, v]: [string, any]) => [k, { costUSD: v.costUSD, out: v.outputTokens }]))
      : undefined,
    sessionId: r?.session_id,
    userMessageUuidMatches: firstAssistant ? firstAssistant.user_message_uuid === turn.uuid : null,
    userMessageUuid: firstAssistant?.user_message_uuid ? 'present' : 'absent',
    replays: frames.filter((x) => x.m.type === 'user' && x.m.isReplay).length,
    texts: texts(s, turn.from, turn.to),
  };
}

function initOf(s: ProbeSession, from = 0, to = s.frames.length) {
  return s.frames.slice(from, to).find((f) => f.m.type === 'system' && f.m.subtype === 'init')?.m;
}

/* --------------------------------- probes --------------------------------- */

async function probe1() {
  console.log('=== 1. Three turns on one query (includePartialMessages on) ===');
  const s = new ProbeSession('probe-01-three-turns', { includePartialMessages: true });
  const pids: (number | null)[] = [];
  for (const word of ['ONE', 'TWO', 'THREE']) {
    const turn = await s.turn(`Reply with exactly the word ${word} and nothing else.`);
    await s.resolvePid();
    pids.push(s.alive() ? s.pid : null);
    const sum = turnSummary(s, turn);
    show(`turn ${word}`, sum);
    show(`  frames`, compact(s.types(turn.from, turn.to)));
    await sleep(1500);
    show(`  after result: process alive=${s.alive()} late frames`, compact(s.types(turn.to)));
  }
  show('pids per turn (same process?)', pids);
  show('distinct session ids', [...new Set(s.frames.map((f) => f.m.session_id).filter(Boolean))].length);
  show('finish', await s.finish());
}

async function probe2() {
  console.log('=== 2. setPermissionMode + setModel mid-turn ===');
  const s = new ProbeSession('probe-02-midturn-controls', { permissionMode: 'default' });
  const from = s.mark();
  s.send(
    'Do these steps in order, one tool call per step. Step 1: run the Bash command `sleep 8`. ' +
      'Step 2: use the Write tool to create the file probe2.txt containing the text x. Step 3: reply DONE.',
  );
  const bash = await s.waitFor((m) => m.type === 'assistant' && m.message?.content?.some((b: any) => b.type === 'tool_use' && b.name === 'Bash'), from, 90_000);
  if (!bash) {
    show('no Bash call', compact(s.types(from)));
    return show('finish', await s.finish());
  }
  await sleep(2000);
  const switchAt = s.now();
  show('setPermissionMode(acceptEdits)', await s.control('setPermissionMode', () => s.q.setPermissionMode('acceptEdits')));
  show('setModel(sonnet)', await s.control('setModel', () => s.q.setModel('sonnet')));
  const result = await s.waitFor((m) => m.type === 'result', from, 120_000);
  show('permission calls', s.permissionCalls.map((c) => `${c.tool}@${c.t >= switchAt ? 'after' : 'before'}`));
  show(
    'assistant models',
    s.frames.slice(from).filter((f) => f.m.type === 'assistant').map((f) => `${f.m.message?.model}@${f.t >= switchAt ? 'after' : 'before'}`),
  );
  show('probe2.txt written', fs.existsSync(path.join(SCRATCH, 'probe2.txt')));
  show('frames', compact(s.types(from)));
  show('result', { subtype: result?.m.subtype, texts: texts(s, from) });
  show('finish', await s.finish());
}

async function probe3(affordance: boolean) {
  const secs = affordance ? 131 : 127;
  const label = `probe-03-interrupt-${affordance ? 'with' : 'without'}-affordance`;
  console.log(`=== 3. Interrupt mid-turn, perTaskStopAffordance=${affordance} ===`);
  const s = new ProbeSession(label, affordance ? { perTaskStopAffordance: true } : {});
  let parkedSignal: string = 'never parked';
  s.onPermission = async (tool, input, { signal }) => {
    if (tool === 'Write') {
      parkedSignal = 'parked, not aborted';
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          parkedSignal = `aborted at +${s.now()}ms`;
          resolve({ behavior: 'deny', message: 'interrupted' });
        });
      });
    }
    return { behavior: 'allow', updatedInput: input };
  };
  s.send(
    `Do these steps in order, one tool call per step. Step 1: run the Bash command \`sleep ${secs}\` with run_in_background set to true. ` +
      'Step 2: use the Write tool to create the file park.txt containing the text x. Step 3: reply DONE.',
  );
  for (let i = 0; i < 600 && parkedSignal === 'never parked' && s.endedAt === null; i++) await sleep(100);
  const bgBefore = pidsMatching(`sleep ${secs}`);
  show('parked', parkedSignal);
  if (parkedSignal === 'never parked') {
    show('frames', compact(s.types()));
    show('finish', await s.finish());
    for (const p of pidsMatching(`sleep ${secs}`)) killIfMatches(p, `sleep ${secs}`);
    return;
  }
  show('background sleep pids before interrupt', bgBefore);
  const queuedUuid = s.send('Reply with exactly the word QUEUED and nothing else.');
  await sleep(300);
  const interruptAt = s.mark();
  const receipt = await s.control('interrupt', () => s.q.interrupt());
  show('interrupt receipt', { ...receipt, queuedUuidListed: JSON.stringify(receipt.value ?? {}).includes(queuedUuid) });
  await sleep(4000);
  show('canUseTool signal', parkedSignal);
  show('frames after interrupt', compact(s.types(interruptAt)));
  show('texts after interrupt', texts(s, interruptAt));
  show('background sleep pids 4s after interrupt', pidsMatching(`sleep ${secs}`));
  const tasks = s.frames.filter((f) => f.m.type === 'system' && /^task_|background_tasks/.test(f.m.subtype));
  show('task frames', tasks.map((f) => `${f.m.subtype}${f.m.status ? `:${f.m.status}` : ''}`));
  const taskId = tasks.find((f) => f.m.subtype === 'task_started')?.m.task_id;
  if (affordance && taskId && pidsMatching(`sleep ${secs}`).length > 0) {
    show('stopTask', await s.control('stopTask', () => s.q.stopTask(taskId)));
    await sleep(2000);
    show('background sleep pids after stopTask', pidsMatching(`sleep ${secs}`));
  }
  const after = await s.turn('Reply with exactly the word AFTER and nothing else.');
  show('turn after interrupt', { subtype: after.result?.m.subtype, processTurnIndex: after.result?.m.process_turn_index, texts: texts(s, after.from, after.to) });
  show('background sleep pids before closing', pidsMatching(`sleep ${secs}`));
  show('finish', await s.finish());
  show('background sleep pids after the process exited', pidsMatching(`sleep ${secs}`));
  for (const p of pidsMatching(`sleep ${secs}`)) killIfMatches(p, `sleep ${secs}`);
}

/** Same interrupt, with a background subagent instead of a background shell. */
async function probe3Agent(affordance: boolean) {
  const secs = affordance ? 47 : 43;
  const marker = `time.sleep(${secs})`;
  console.log(`=== 3b. Interrupt with a background subagent, perTaskStopAffordance=${affordance} ===`);
  const s = new ProbeSession(`probe-03-interrupt-agent-${affordance ? 'with' : 'without'}-affordance`, affordance ? { perTaskStopAffordance: true } : {});
  let parked = false;
  s.onPermission = async (tool, input, { signal }) => {
    if (tool === 'Write') {
      parked = true;
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ behavior: 'deny', message: 'interrupted' })));
    }
    return { behavior: 'allow', updatedInput: input };
  };
  s.send(
    'Do these steps in order. Step 1: use the Agent tool with run_in_background set to true, subagent_type "general-purpose", ' +
      `description "probe", and prompt "Run this exact Bash command in the foreground: python3 -c 'import time; time.sleep(${secs})' and then reply done." ` +
      'Step 2: use the Write tool to create the file park.txt containing the text x. Step 3: reply DONE.',
  );
  for (let i = 0; i < 900 && !parked && s.endedAt === null; i++) await sleep(100);
  for (let i = 0; i < 100 && pidsMatching(marker).length === 0; i++) await sleep(200);
  show('parked', parked);
  show('subagent sleep pids before interrupt', pidsMatching(marker));
  const at = s.mark();
  show('interrupt receipt', await s.control('interrupt', () => s.q.interrupt()));
  await sleep(4000);
  show('subagent sleep pids 4s after interrupt', pidsMatching(marker));
  show('frames after interrupt', compact(s.types(at)));
  show('task frames', s.frames.filter((f) => f.m.type === 'system' && /^task_/.test(f.m.subtype)).map((f) => `${f.m.subtype}${f.m.status ? `:${f.m.status}` : ''}${f.m.task_type ? `(${f.m.task_type})` : ''}`));
  const taskId = s.frames.find((f) => f.m.subtype === 'task_started' && !f.m.subagent_type?.includes?.('bash'))?.m.task_id;
  if (affordance && taskId && pidsMatching(marker).length > 0) {
    show('stopTask', await s.control('stopTask', () => s.q.stopTask(taskId)));
    await sleep(2000);
    show('subagent sleep pids after stopTask', pidsMatching(marker));
  }
  show('finish', await s.finish());
  for (const p of pidsMatching(marker)) killIfMatches(p, marker);
}

async function probe4(mode: 'auto' | 'bypassPermissions' | 'default', hook: boolean) {
  const label = `probe-04-question-${mode === 'bypassPermissions' ? 'bypass' : mode}-${hook ? 'hook' : 'nohook'}`;
  console.log(`=== 4. AskUserQuestion, mode=${mode}, PreToolUse hook=${hook} ===`);
  const hookCalls: string[] = [];
  const s = new ProbeSession(label, {
    permissionMode: mode,
    ...(hook
      ? {
          hooks: {
            PreToolUse: [
              {
                matcher: 'AskUserQuestion',
                hooks: [
                  async (input: any) => {
                    hookCalls.push(input.tool_name);
                    return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'ask' as const } };
                  },
                ],
              },
            ],
          },
        }
      : {}),
  });
  s.onPermission = async (tool, input) => {
    if (tool === 'AskUserQuestion') {
      const q = (input.questions as any[])?.[0]?.question ?? 'Which color?';
      return { behavior: 'allow', updatedInput: { ...input, answers: { [q]: 'blue' } } };
    }
    return { behavior: 'allow', updatedInput: input };
  };
  const turn = await s.turn(
    'Use the AskUserQuestion tool to ask me one question, "Which color?", with the options "red" and "blue". ' +
      'After I answer, reply with exactly the color I chose.',
  );
  show('init permissionMode', initOf(s)?.permissionMode);
  show('canUseTool calls', s.permissionCalls.map((c) => c.tool));
  show('hook calls', hookCalls);
  show('tool results', toolResults(s, turn.from, turn.to));
  show('permission_denied frames', s.frames.filter((f) => f.m.type === 'system' && f.m.subtype === 'permission_denied').length);
  show('frames', compact(s.types(turn.from, turn.to)));
  show('final texts', texts(s, turn.from, turn.to));
  show('finish', await s.finish());
}

async function probe5(flag: boolean) {
  console.log(`=== 5. setPermissionMode(bypassPermissions) on a default session, allowDangerouslySkipPermissions=${flag} ===`);
  const s = new ProbeSession(`probe-05-bypass-switch-${flag ? 'flag' : 'noflag'}`, {
    permissionMode: 'default',
    ...(flag ? { allowDangerouslySkipPermissions: true } : {}),
  });
  const tag = flag ? 'flag' : 'noflag';
  const before = await s.turn(`Use the Write tool to create the file p5-${tag}-a.txt containing the text x. Then reply DONE.`);
  show('baseline (default mode)', { initMode: initOf(s, before.from, before.to)?.permissionMode, canUseTool: s.permissionCalls.map((c) => c.tool) });
  const switchAt = s.now();
  show('setPermissionMode', await s.control('setPermissionMode', () => s.q.setPermissionMode('bypassPermissions')));
  const turn = await s.turn(`Use the Write tool to create the file p5-${tag}-b.txt containing the text x. Then reply DONE.`);
  show('init permissionMode after switch', initOf(s, turn.from, turn.to)?.permissionMode);
  show('canUseTool calls after switch', s.permissionCalls.filter((c) => c.t >= switchAt).map((c) => c.tool));
  show('file b written', fs.existsSync(path.join(SCRATCH, `p5-${tag}-b.txt`)));
  show('frames', compact(s.types(turn.from, turn.to)));
  show('finish', await s.finish());
}

async function probe6() {
  console.log('=== 6. applyFlagSettings({effortLevel: null}) and ({model: null}) ===');
  // init carries no effort on this CLI; a Stop hook's input reports the level the turn ran at.
  const efforts: string[] = [];
  const s = new ProbeSession('probe-06-effort-reset', {
    model: 'sonnet',
    effort: 'low',
    hooks: {
      Stop: [{ hooks: [async (input: any) => {
        efforts.push(input.effort?.level ?? 'absent');
        return {};
      }] }],
    },
  });
  const step = async (label: string) => {
    const before = efforts.length;
    const turn = await s.turn('Reply with exactly OK and nothing else.');
    await sleep(500);
    const init = initOf(s, turn.from, turn.to);
    const asst = s.frames.slice(turn.from, turn.to).find((f) => f.m.type === 'assistant')?.m;
    show(label, {
      stopHookEffort: efforts.slice(before),
      initModel: init?.model,
      apiModel: asst?.message?.model,
      result: turn.result?.m.is_error ? String(turn.result.m.result).slice(0, 100) : turn.result?.m.subtype,
    });
  };
  await step('option effort=low');
  show('apply effortLevel=xhigh', await s.control('applyFlagSettings', () => s.q.applyFlagSettings({ effortLevel: 'xhigh' })));
  await step('after effortLevel=xhigh');
  show('apply effortLevel=null', await s.control('applyFlagSettings', () => s.q.applyFlagSettings({ effortLevel: null })));
  await step('after effortLevel=null');
  show('apply model=null', await s.control('applyFlagSettings', () => s.q.applyFlagSettings({ model: null } as any)));
  await step('after model=null');
  const models = (await s.control('supportedModels', () => s.q.supportedModels())).value as any[];
  show('default entry', models?.find((m) => m.value === 'default'));
  show('user settings effortLevel', JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, 'settings.json'), 'utf8')).effortLevel);
  show('finish', await s.finish());
}

async function probe7() {
  console.log('=== 7. Does an error result end the iterator? ===');
  const a = new ProbeSession('probe-07-api-error');
  const ok = await a.turn('Reply with exactly OK and nothing else.');
  show('turn 1', { subtype: ok.result?.m.subtype });
  show('setModel(bogus)', await a.control('setModel', () => a.q.setModel('claude-nonexistent-0-0')));
  const bad = await a.turn('Reply with exactly OK and nothing else.', 90_000);
  show('turn 2 (bogus model)', {
    ...turnSummary(a, bad),
    result: typeof bad.result?.m.result === 'string' ? bad.result.m.result.slice(0, 160) : undefined,
    errors: bad.result?.m.errors,
  });
  show('  frames', compact(a.types(bad.from, bad.to)));
  await sleep(1500);
  show('iterator ended after error result?', { ended: a.endedAt !== null, error: a.error, alive: a.alive() });
  if (a.endedAt === null) {
    await a.control('setModel', () => a.q.setModel(CHEAP));
    const again = await a.turn('Reply with exactly AGAIN and nothing else.');
    show('turn 3 (back on haiku)', { subtype: again.result?.m.subtype, texts: texts(a, again.from, again.to) });
  }
  show('finish', await a.finish());

  const b = new ProbeSession('probe-07-max-turns', { maxTurns: 1 });
  const capped = await b.turn('Run the Bash command `echo hi`, then reply DONE.');
  show('maxTurns=1 turn', { subtype: capped.result?.m.subtype, isError: capped.result?.m.is_error });
  await sleep(1500);
  show('iterator ended after error_max_turns?', { ended: b.endedAt !== null, error: b.error, alive: b.alive() });
  if (b.endedAt === null) {
    const next = await b.turn('Reply with exactly NEXT and nothing else.');
    show('next turn', { subtype: next.result?.m.subtype, texts: texts(b, next.from, next.to) });
  }
  show('finish', await b.finish());
}

async function probe8(withEnv: boolean) {
  console.log(`=== 8. Session-state / tool-summary / title frames, env vars ${withEnv ? 'on' : 'off'} ===`);
  const env: Record<string, string> = withEnv
    ? { CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '1' }
    : {};
  const s = new ProbeSession(`probe-08-frames-env-${withEnv ? 'on' : 'off'}`, {}, env);
  const t1 = await s.turn('Run the Bash command `echo hi`, then reply DONE.');
  await sleep(3000);
  const t2 = await s.turn('Reply with exactly OK and nothing else.');
  await sleep(3000);
  const states = s.frames.filter((f) => f.m.subtype === 'session_state_changed').map((f) => `${f.m.state}@${f.t}`);
  show('result times', [t1.result?.t, t2.result?.t]);
  show('session_state_changed', states);
  show('tool_use_summary', s.frames.filter((f) => f.m.type === 'tool_use_summary').map((f) => f.m.summary));
  show('title-ish frames', s.frames.filter((f) => /title/i.test(`${f.m.type}/${f.m.subtype ?? ''}`)).map((f) => frameKey(f.m)));
  show('distinct frame kinds', [...new Set(s.types())].sort());
  show('finish', await s.finish());
}

async function probe9() {
  console.log('=== 9. Options.sessionId ===');
  const id = randomUUID();
  remember(id);
  const s = new ProbeSession('probe-09-session-id', { sessionId: id });
  const turn = await s.turn('Reply with exactly OK and nothing else.');
  const ids = [...new Set(s.frames.map((f) => f.m.session_id).filter(Boolean))];
  show('frame session ids equal the chosen id', ids.length === 1 && ids[0] === id);
  show('first frame carrying the id', s.frames.find((f) => f.m.session_id === id) ? frameKey(s.frames.find((f) => f.m.session_id === id)!.m) : null);
  show('transcript written under the id', fs.existsSync(path.join(PROJECT_DIR, `${id}.jsonl`)));
  show('turn', { subtype: turn.result?.m.subtype });
  show('finish', await s.finish());

  const other = randomUUID();
  const r = new ProbeSession('probe-09-session-id-with-resume', { sessionId: other, resume: id });
  const init = await r.control('initializationResult', () => r.q.initializationResult());
  show('sessionId + resume without forkSession', { init: init.ok ? 'ok' : init.error, iteratorError: r.error });
  if (init.ok && r.endedAt === null) {
    const t = await r.turn('Reply with exactly OK and nothing else.');
    show('  turn', { subtype: t.result?.m.subtype, ids: [...new Set(r.frames.map((f) => f.m.session_id).filter(Boolean))], expected: { other, id } });
  }
  show('finish', await r.finish());
}

async function probe10() {
  for (const [cwd, name] of [[REPO, 'repo'], [SCRATCH, 'scratch']] as const) {
    console.log(`=== 10. Idle query, no message sent, cwd=${name} ===`);
    const s = new ProbeSession(`probe-10-idle-${name}`, { cwd });
    const init = await s.control('initializationResult', () => s.q.initializationResult());
    await s.resolvePid();
    const commands = await s.control('supportedCommands', () => s.q.supportedCommands());
    const models = await s.control('supportedModels', () => s.q.supportedModels());
    const agents = await s.control('supportedAgents', () => s.q.supportedAgents());
    const account = await s.control('accountInfo', () => s.q.accountInfo());
    const v: any = init.value ?? {};
    show('initializationResult', { ok: init.ok, ms: init.ms, keys: Object.keys(v), commands: v.commands?.length, error: init.error });
    show('supportedCommands', { ms: commands.ms, count: (commands.value as any[])?.length, sample: (commands.value as any[])?.slice(0, 3) });
    show('supportedModels', { ms: models.ms, count: (models.value as any[])?.length });
    show('supportedAgents', { ms: agents.ms, count: (agents.value as any[])?.length });
    show('accountInfo keys', { ms: account.ms, keys: Object.keys((account.value as object) ?? {}) });
    show('frames while idle', compact(s.types()));
    show('memory', treeMem(s.pid));
    s.act('initializationResult', { value: v });
    s.act('supportedCommands', { value: commands.value });
    show('finish', await s.finish());
  }
}

async function probe11() {
  console.log('=== 11. Background task wakes a turn after result, input open ===');
  const s = new ProbeSession('probe-11-background-wake', {}, { CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' });
  const first = await s.turn(
    'Run the Bash command `sleep 15` with run_in_background set to true. Do not wait for it and do not check on it. Reply STARTED and end your turn.',
  );
  show('first result at', first.result?.t);
  const woke = await s.waitFor((m) => m.type === 'assistant', first.to, 90_000);
  const second = woke ? await s.waitFor((m) => m.type === 'result', woke.i, 90_000) : null;
  show('woken assistant frame', woke ? { t: woke.t, afterResultMs: woke.t - first.result!.t } : 'none within 90s');
  show('second result', second ? { t: second.t, subtype: second.m.subtype } : null);
  show('frames after first result', compact(s.types(first.to)));
  show('session states', s.frames.filter((f) => f.m.subtype === 'session_state_changed').map((f) => `${f.m.state}@${f.t}`));
  show('woken texts', texts(s, first.to));
  show('finish', await s.finish());
}

async function probe12(ceilingMs: number | null) {
  const secs = ceilingMs === null ? 23 : 29;
  const label = `probe-12-closed-input-${ceilingMs === null ? 'default-ceiling' : `ceiling-${ceilingMs}`}`;
  console.log(`=== 12. Input closed at result, background sleep ${secs}s, ceiling ${ceilingMs ?? 'default (600000)'} ===`);
  const s = new ProbeSession(label, {}, ceilingMs === null ? {} : { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(ceilingMs) });
  const first = await s.turn(
    `Run the Bash command \`sleep ${secs}\` with run_in_background set to true. Do not wait for it and do not check on it. Reply STARTED and end your turn.`,
  );
  await s.resolvePid();
  s.closeInput();
  const closedAt = s.now();
  show('first result', { t: first.result?.t, subtype: first.result?.m.subtype });
  const checks: string[] = [];
  for (let i = 0; i < (secs + 20) / 2.5 && s.endedAt === null; i++) {
    await sleep(2500);
    checks.push(`+${Math.round((s.now() - closedAt) / 1000)}s sleep=${pidsMatching(`sleep ${secs}`).length > 0} claude=${s.alive()}`);
  }
  await Promise.race([s.done, sleep(5000)]);
  show('checks after closing input', checks);
  show('iterator ended', s.endedAt !== null ? { afterCloseMs: s.endedAt - closedAt, error: s.error } : 'still open');
  show('frames after first result', compact(s.types(first.to)));
  show('woken texts', texts(s, first.to));
  show('finish', await s.finish());
  for (const p of pidsMatching(`sleep ${secs}`)) killIfMatches(p, `sleep ${secs}`);
}

function lastContextTokens(file: string): number {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    try {
      const u = JSON.parse(lines[i]).message?.usage;
      if (u) return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    } catch {
      /* partial line */
    }
  }
  return 0;
}

function transcriptsBySize(): { file: string; bytes: number }[] {
  const root = path.join(CLAUDE_HOME, 'projects');
  const out: { file: string; bytes: number }[] = [];
  for (const dir of fs.readdirSync(root)) {
    if (path.join(root, dir) === PROJECT_DIR) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, dir));
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const file = path.join(root, dir, n);
      out.push({ file, bytes: fs.statSync(file).size });
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** A copy under the scratch project, so resuming it never appends to a real session. */
function copyTranscript(file: string): string {
  const id = randomUUID();
  remember(id);
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.copyFileSync(file, path.join(PROJECT_DIR, `${id}.jsonl`));
  return id;
}

/** The cold turn's spawn split, from init's startup_timing. */
function startupOf(s: ProbeSession) {
  const st = initOf(s)?.startup_timing?.phases;
  return st
    ? { node_boot_ms: st.node_boot_ms, initial_messages_load_ms: st.initial_messages_load_ms, input_ready_ms: st.input_ready_ms, first_message_read_ms: st.first_message_read_ms }
    : null;
}

async function probe13() {
  const FLOOR_MB = 450;
  console.log('=== 13a. Three idle sessions, opened one after another ===');
  const baseline = memAvailableMB();
  show('MemAvailable before', `${baseline} MB`);
  const open: ProbeSession[] = [];
  for (let i = 0; i < 3; i++) {
    if (memAvailableMB() < FLOOR_MB) {
      show(`stopped before session ${i + 1}`, `MemAvailable ${memAvailableMB()} MB < ${FLOOR_MB} MB floor`);
      break;
    }
    const s = new ProbeSession(`probe-13-idle-${i + 1}`);
    await s.control('initializationResult', () => s.q.initializationResult());
    await s.resolvePid();
    const preTurn = treeMem(s.pid);
    const turn = await s.turn('Reply with exactly OK and nothing else.');
    await sleep(3000);
    open.push(s);
    show(`session ${i + 1}`, {
      beforeFirstTurn: preTurn,
      idleAfterTurn: treeMem(s.pid),
      memAvailableMB: memAvailableMB(),
      turnMs: turn.result ? turn.result.t - turn.sentAt : null,
    });
  }
  show('all open', open.map((s) => treeMem(s.pid)));
  show('MemAvailable with all open', `${memAvailableMB()} MB (drop ${baseline - memAvailableMB()} MB)`);
  for (const s of open) await s.finish(10_000);
  await sleep(2000);
  show('MemAvailable after closing', `${memAvailableMB()} MB`);

  console.log('=== 13b. Resumed large session (copy), idle ===');
  const largest = transcriptsBySize()[0];
  const largeId = copyTranscript(largest.file);
  show('copied', { mb: +(largest.bytes / 1048576).toFixed(1), contextTokens: lastContextTokens(largest.file) });
  const big = new ProbeSession('probe-13-resumed-large', { resume: largeId });
  const init = await big.control('initializationResult', () => big.q.initializationResult());
  await big.resolvePid();
  await sleep(2000);
  show('after initialize, no turn', { initMs: init.ms, mem: treeMem(big.pid) });
  const cost = await big.turn('/cost', 60_000);
  await sleep(2000);
  show('after /cost (local command)', {
    resultMs: cost.result ? cost.result.t - cost.sentAt : null,
    apiCalled: big.frames.slice(cost.from, cost.to).some((f) => f.m.type === 'rate_limit_event' || f.m.type === 'stream_event'),
    frames: compact(big.types(cost.from, cost.to)),
    phases: cost.result?.m.time_to_request_phases_ms,
    startup: startupOf(big),
    mem: treeMem(big.pid),
  });
  show('finish', await big.finish());

  console.log('=== 13c. Mid-turn on a resumed session that fits haiku ===');
  const mid = transcriptsBySize().find((t) => t.bytes > 1_000_000 && lastContextTokens(t.file) > 0 && lastContextTokens(t.file) <= 120_000);
  if (!mid) return show('no transcript under 120K tokens and over 1 MB', '');
  const midId = copyTranscript(mid.file);
  show('copied', { mb: +(mid.bytes / 1048576).toFixed(1), contextTokens: lastContextTokens(mid.file) });
  const s = new ProbeSession('probe-13-midturn', { resume: midId });
  const from = s.mark();
  const sentAt = s.now();
  s.send('Run the Bash command `sleep 6`, then reply DONE.');
  const toolUse = await s.waitFor((m) => m.type === 'assistant' && m.message?.content?.some((b: any) => b.type === 'tool_use'), from, 180_000);
  await s.resolvePid();
  await sleep(2000);
  show('mid-turn (tool running)', { atMs: toolUse ? toolUse.t - sentAt : null, mem: treeMem(s.pid), memAvailableMB: memAvailableMB() });
  const result = await s.waitFor((m) => m.type === 'result', from, 180_000);
  await sleep(2000);
  show('after result (idle)', {
    resultMs: result ? result.t - sentAt : null,
    initMs: s.frames.slice(from).find((f) => f.m.subtype === 'init')?.t,
    ttftMs: result?.m.ttft_ms,
    timeToRequestMs: result?.m.time_to_request_ms,
    phases: result?.m.time_to_request_phases_ms,
    startup: startupOf(s),
    mem: treeMem(s.pid),
  });
  show('finish', await s.finish());
}

/* -------------------------------- cleanup -------------------------------- */

function cleanup() {
  console.log('=== cleanup (filesystem; database rows are listed, not touched) ===');
  for (const target of [SCRATCH, PROJECT_DIR]) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`  removed ${target}`);
    }
  }
  const ids = ledger.sessionIds;
  const scan = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (p === path.join(CLAUDE_HOME, 'projects')) continue;
      if (ids.some((id) => e.name.includes(id))) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`  removed ${p}`);
      } else if (e.isDirectory() && depth < 2) {
        scan(p, depth + 1);
      }
    }
  };
  scan(CLAUDE_HOME, 0);
  console.log(`  ${ids.length} probe session ids in ${LEDGER}; database rows to delete next:`);
  console.log(`    sessions / session_provider_aliases with project_path = '${SCRATCH}', projects row '${SCRATCH}'`);
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const which = process.argv[2];
  if (which === 'cleanup') return cleanup();
  fs.mkdirSync(SCRATCH, { recursive: true });
  console.log(`MemAvailable ${memAvailableMB()} MB, claude ${execFileSync(resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH), ['--version']).toString().trim()}`);
  switch (which) {
    case '1': return probe1();
    case '2': return probe2();
    case '3': await probe3(false); return probe3(true);
    case '3b': await probe3Agent(false); return probe3Agent(true);
    case '4':
      for (const mode of ['auto', 'bypassPermissions'] as const) {
        await probe4(mode, false);
        await probe4(mode, true);
      }
      return;
    case '4auto': await probe4('auto', false); return probe4('auto', true);
    case '5': await probe5(false); return probe5(true);
    case '6': return probe6();
    case '7': return probe7();
    case '8': await probe8(false); return probe8(true);
    case '9': return probe9();
    case '10': return probe10();
    case '11': return probe11();
    case '12': await probe12(null); return probe12(5000);
    case '13': return probe13();
    default:
      console.error('usage: npx tsx scripts/verify-claude-session-sdk.ts <1-13|cleanup>');
      process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('probe failed:', err);
    process.exit(1);
  });

/*
 * FINDINGS — run 2026-10-05, SDK 0.3.286, CLI 2.1.286, haiku unless noted.
 *
 *  1  One process (same pid, process_turn_index 0/1/2) and one session id for
 *     three turns. Cold turn: init 3.8 s after send, message_start 4.7 s,
 *     result 5.1 s. Warm turns: init 50-80 ms, message_start ~0.6 s, result
 *     ~0.9 s. init is re-emitted every turn. total_cost_usd, modelUsage and
 *     duration_api_ms are running totals; usage and duration_ms are per turn.
 *     No isReplay echo of sent input. The delivery receipt is command_lifecycle
 *     (queued / started / completed / cancelled, keyed by the sent uuid; not in
 *     the SDKMessage union) plus user_message_uuid on the turn's first assistant
 *     frame. rate_limit_event may come before, after or not at all in a turn.
 *  2  Mid-turn setModel('sonnet') moved the next API call of the same turn to
 *     sonnet; mid-turn setPermissionMode('acceptEdits') kept the next Write from
 *     canUseTool. 7 ms and 334 ms. setModel emits a user isReplay frame carrying
 *     "<local-command-stdout>Set model to …" — the only isReplay frames seen.
 *  3  Interrupt while canUseTool is parked: 6-8 ms; still_queued lists the
 *     message pushed meanwhile; canUseTool's signal aborts; the turn ends
 *     error_during_execution, the queued message runs next, the process lives.
 *     A background SHELL survives a bare interrupt with or without
 *     perTaskStopAffordance (it dies with the process). A background SUBAGENT is
 *     killed by a bare interrupt (task_notification stopped) and survives with
 *     the affordance; stopTask ends it in 13 ms.
 *  4  AskUserQuestion reached canUseTool with no hook in bypassPermissions and
 *     in auto (auto needs sonnet; haiku falls back to default). A PreToolUse hook
 *     answering 'ask' fires and causes no second prompt.
 *  5  setPermissionMode('bypassPermissions') rejects without
 *     allowDangerouslySkipPermissions ("session was not launched with
 *     --dangerously-skip-permissions") and works with it; default mode still
 *     asks with the flag set. A system/status frame carries the new mode.
 *  6  applyFlagSettings({effortLevel: null}) ran the next turn at the model's
 *     own default (sonnet 5.5: medium), not settings.json's high nor the
 *     starting low. ({model: null}) went to "Default (recommended)" =
 *     claude-fable-5-1, which this account cannot use ("out of usage credits").
 *     init has no effort field at 2.1.286; a Stop hook's input.effort.level does.
 *     A set effortLevel 'high' overrides a spawn effort 'low' from the next
 *     request (2026-10-06).
 *  7  Error results do not end the iterator: error_max_turns, the out-of-credits
 *     result and error_during_execution were each followed by a working turn.
 *     setModel with an unknown id rejects at the control call. When the LAST
 *     result was an error, closing the input exits the CLI with code 1 and the
 *     iterator throws "Claude Code process exited with code 1".
 *  8  session_state_changed reaches the consumer only with
 *     CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 (otherwise the CLI marks it
 *     sdk_host_only and the SDK swallows it); idle lands ~8 ms after result.
 *     tool_use_summary arrives with CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1. No
 *     session_title_changed in either run.
 *  9  Options.sessionId names every frame (from the first command_lifecycle)
 *     and the transcript file. With resume and no forkSession the CLI exits:
 *     "--session-id can only be used with --continue or --resume if
 *     --fork-session is also specified".
 * 10  An idle query that never sends: initializationResult 4.5 s (repo) and
 *     10.3 s (fresh cwd); then supportedCommands 58 / 57, supportedModels 12,
 *     supportedAgents 5 and accountInfo answer in ≤1 ms. No frames while idle.
 * 11  On an open input a background `sleep 15` finishing starts a new turn
 *     15.5 s after the result (task_notification, running, init, reply). The
 *     session reports idle right after the first result although the shell runs.
 * 12  Input closed at the result with a background shell running: the CLI
 *     exits ~5.3 s later and kills the shell (task_updated killed); no wake.
 *     The SDK's 600 s ceiling never arms, because the session is already idle;
 *     CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000 changed nothing.
 * 13  Idle after one turn: RSS ~234, PSS ~150, USS ~122 MB. Three open at once
 *     took MemAvailable from 637 to 434 MB. A resumed 16.9 MB / 267K-token
 *     transcript: load 408 ms, USS 138 → 153 MB. Mid-turn on a resumed 113K-token
 *     session: 169 MB USS for the tree.
 *     Cold spawn split (init.startup_timing): input_ready_ms 2.7-2.9 s, of which
 *     node boot 0.4-0.7 s and skills load ~0.8 s; initial_messages_load_ms 2 ms
 *     new, 253 ms (2.7 MB), 408 ms (16.9 MB); time_to_request 0.7-0.8 s cold
 *     against 0.1-0.15 s warm.
 *     Production [turn] logs, 240 turns 2026-09-28 to 2026-10-05: send to first
 *     frame 3.27 s median resumed, 3.06 s new (p90 4.4 s), no difference between
 *     contexts under 60K and over 150K tokens. A long-lived query saves ~3.5 s
 *     per message whatever the session's size. The ~10 s median from first frame
 *     to the first rate_limit_event on resumed turns is API time, not loading.
 */
