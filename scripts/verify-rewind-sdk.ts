/**
 * verify-rewind-sdk.ts — empirical probe of the Agent SDK's rewind surface.
 *
 * Run from the repo root (uses the repo's installed SDK + the user's Claude login;
 * costs a handful of haiku turns):
 *
 *   npx tsx scripts/verify-rewind-sdk.ts
 *
 * Answers the verification questions for the chat-rewind feature
 * (see docs/specs + docs/plans):
 *   V1 — resumeSessionAt: is a user-message uuid accepted? is the anchor inclusive?
 *   V2 — does resume+resumeSessionAt continue the SAME session id (in place) or fork?
 *        what happens to the original transcript jsonl on disk?
 *   V3 — behavior when the anchor uuid does not exist in the session.
 *   V4 — on fork, does the new session id arrive on the first streamed message?
 *   V5 — where enableFileCheckpointing stores snapshots (Pi disk-usage question).
 *   V7 — do all real user transcript entries carry a uuid?
 *
 * FINDINGS (recorded after each run) — see the trailing "FINDINGS" comment block.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeExecutablePath } from '../server/shared/claude-cli-path.js';

const SCRATCH = '/tmp/rewind-probe';
const MODEL = 'haiku';
const CLAUDE_HOME = path.join(os.homedir(), '.claude');

type TurnResult = {
  sessionIds: string[];
  firstMessageSessionId: string | null;
  texts: string[];
  resultSubtype: string | null;
  error: string | null;
};

function baseOptions(extra: Record<string, unknown> = {}) {
  return {
    env: { ...process.env },
    pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    cwd: SCRATCH,
    model: MODEL,
    systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
    settingSources: ['project', 'user', 'local'] as ('project' | 'user' | 'local')[],
    allowedTools: [] as string[],
    ...extra,
  };
}

async function runTurn(prompt: string, extra: Record<string, unknown> = {}): Promise<TurnResult> {
  const out: TurnResult = { sessionIds: [], firstMessageSessionId: null, texts: [], resultSubtype: null, error: null };
  try {
    const q = query({ prompt, options: baseOptions(extra) });
    for await (const message of q as AsyncIterable<Record<string, any>>) {
      const sid = message.session_id;
      if (typeof sid === 'string') {
        if (out.firstMessageSessionId === null) out.firstMessageSessionId = sid;
        if (!out.sessionIds.includes(sid)) out.sessionIds.push(sid);
      }
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && block.text) out.texts.push(block.text);
          }
        }
      }
      if (message.type === 'result') {
        out.resultSubtype = message.subtype ?? null;
        if (message.is_error) out.error = String(message.result ?? message.subtype);
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

/* ------------------------- transcript inspection ------------------------- */

function projectDir(): string {
  return path.join(CLAUDE_HOME, 'projects', SCRATCH.replace(/[^a-zA-Z0-9]/g, '-'));
}

type Entry = {
  uuid?: string;
  parentUuid?: string | null;
  type?: string;
  role?: string;
  preview: string;
  isSidechain?: boolean;
};

function readTranscript(sessionId: string): Entry[] {
  const file = path.join(projectDir(), `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const raw = JSON.parse(line);
        const content = raw.message?.content;
        let preview = '';
        if (typeof content === 'string') preview = content;
        else if (Array.isArray(content)) {
          preview = content
            .map((b: any) => (b?.type === 'text' ? b.text : `[${b?.type}]`))
            .join(' ');
        }
        return {
          uuid: raw.uuid,
          parentUuid: raw.parentUuid ?? null,
          type: raw.type,
          role: raw.message?.role,
          preview: preview.slice(0, 60).replace(/\n/g, ' '),
          isSidechain: raw.isSidechain,
        } satisfies Entry;
      } catch {
        return { preview: '<unparseable>' } satisfies Entry;
      }
    });
}

function listSessionFiles(): { name: string; lines: number; mtime: number }[] {
  const dir = projectDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = path.join(dir, f);
      return {
        name: f,
        lines: fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length,
        mtime: fs.statSync(p).mtimeMs,
      };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

function printTranscript(label: string, sessionId: string) {
  console.log(`  transcript ${label} (${sessionId}):`);
  for (const e of readTranscript(sessionId)) {
    console.log(
      `    ${e.type ?? '?'}/${e.role ?? '-'} uuid=${e.uuid ?? 'NONE'} parent=${e.parentUuid ?? '-'}${e.isSidechain ? ' SIDECHAIN' : ''} :: ${e.preview}`
    );
  }
}

function findMarkers(sessionId: string): string[] {
  const found: string[] = [];
  for (const marker of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE']) {
    if (readTranscript(sessionId).some((e) => e.preview.includes(marker))) found.push(marker);
  }
  return found;
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });

  console.log('=== Baseline: 3 turns (ONE / TWO / THREE) ===');
  const t1 = await runTurn('Reply with exactly the word: ONE');
  const sid = t1.firstMessageSessionId;
  if (!sid) throw new Error(`no session id from turn 1: ${t1.error}`);
  console.log(`  turn1 sid=${sid} texts=${JSON.stringify(t1.texts)} err=${t1.error}`);
  const t2 = await runTurn('Reply with exactly the word: TWO', { resume: sid });
  console.log(`  turn2 sids=${t2.sessionIds} texts=${JSON.stringify(t2.texts)} err=${t2.error}`);
  const t3 = await runTurn('Reply with exactly the word: THREE', { resume: sid });
  console.log(`  turn3 sids=${t3.sessionIds} texts=${JSON.stringify(t3.texts)} err=${t3.error}`);

  printTranscript('baseline', sid);
  const baseline = readTranscript(sid);
  const mainChain = baseline.filter((e) => !e.isSidechain && e.uuid && (e.type === 'user' || e.type === 'assistant'));
  const users = mainChain.filter((e) => e.type === 'user');
  const assistants = mainChain.filter((e) => e.type === 'assistant');
  console.log(`\n[V7] user entries without uuid: ${baseline.filter((e) => e.type === 'user' && !e.uuid).length}`);
  const asst1 = assistants.find((e) => e.preview.includes('ONE'));
  const user2 = users.find((e) => e.preview.includes('TWO'));
  if (!asst1 || !user2) throw new Error('could not locate anchor entries in baseline transcript');
  const filesBefore = listSessionFiles();
  const originalLines = filesBefore.find((f) => f.name === `${sid}.jsonl`)?.lines;
  console.log(`  anchors: asst1=${asst1.uuid} user2=${user2.uuid}; files=${JSON.stringify(filesBefore)}`);

  console.log('\n=== Probe A [V1-inclusive, V2, V4]: resume + resumeSessionAt=<assistant#1 uuid>, send FOUR ===');
  const a = await runTurn('Reply with exactly the word: FOUR', { resume: sid, resumeSessionAt: asst1.uuid });
  console.log(`  firstMsgSid=${a.firstMessageSessionId} allSids=${a.sessionIds} texts=${JSON.stringify(a.texts)} err=${a.error}`);
  const aSid = a.firstMessageSessionId ?? sid;
  console.log(`  [V2] same session id as original? ${aSid === sid}`);
  console.log(`  [V4] new id on first streamed message? firstMsgSid=${a.firstMessageSessionId}`);
  const filesAfterA = listSessionFiles();
  console.log(`  files after: ${JSON.stringify(filesAfterA)} (original was ${originalLines} lines)`);
  console.log(`  [V1] markers in RESULT transcript (${aSid}): ${findMarkers(aSid)} — expect ONE+FOUR, no TWO/THREE if anchor inclusive`);
  console.log(`  markers still in ORIGINAL (${sid}): ${findMarkers(sid)}`);
  printTranscript('after probe A (result session)', aSid);

  console.log('\n=== Probe B [V1-user-uuid]: resume + resumeSessionAt=<user "TWO" uuid>, send FIVE ===');
  // Re-derive from the CURRENT original file in case probe A rewrote it.
  const currentUsers = readTranscript(sid).filter((e) => e.type === 'user' && e.uuid && !e.isSidechain);
  const userAnchor = currentUsers.find((e) => e.preview.includes('TWO')) ?? currentUsers[0];
  if (userAnchor) {
    const b = await runTurn('Reply with exactly the word: FIVE', { resume: sid, resumeSessionAt: userAnchor.uuid });
    const bSid = b.firstMessageSessionId ?? sid;
    console.log(`  anchor(user)=${userAnchor.uuid} firstMsgSid=${b.firstMessageSessionId} err=${b.error}`);
    console.log(`  [V1] user uuid accepted? ${!b.error}; markers in result (${bSid}): ${findMarkers(bSid)}`);
  } else {
    console.log('  SKIPPED: no user anchor found in original transcript');
  }

  console.log('\n=== Probe C [V3-adjacent]: resume + resumeSessionAt=<nonexistent uuid> ===');
  const c = await runTurn('Reply with exactly the word: SIX', {
    resume: sid,
    resumeSessionAt: '00000000-0000-4000-8000-000000000000',
  });
  console.log(`  firstMsgSid=${c.firstMessageSessionId} subtype=${c.resultSubtype} err=${c.error} texts=${JSON.stringify(c.texts)}`);

  console.log('\n=== Probe D [V5]: enableFileCheckpointing storage location ===');
  const startedAt = Date.now();
  const d = await runTurn(
    "Use the Write tool to create a file named probe.txt containing exactly: hello. Then reply DONE.",
    { enableFileCheckpointing: true, permissionMode: 'bypassPermissions', allowedTools: ['Write'] }
  );
  console.log(`  sid=${d.firstMessageSessionId} texts=${JSON.stringify(d.texts)} err=${d.error}`);
  console.log(`  probe.txt created: ${fs.existsSync(path.join(SCRATCH, 'probe.txt'))}`);
  const recent: string[] = [];
  const scan = (dir: string, depth: number) => {
    if (depth > 4 || recent.length > 30) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'projects' && dir === CLAUDE_HOME) continue; // transcripts, known
      const p = path.join(dir, e.name);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= startedAt && !e.isDirectory()) recent.push(p);
        if (e.isDirectory() && st.mtimeMs >= startedAt - 60_000) scan(p, depth + 1);
      } catch {
        /* ignore */
      }
    }
  };
  scan(CLAUDE_HOME, 0);
  console.log(`  [V5] files under ~/.claude touched since probe D started (projects/ excluded):`);
  for (const f of recent) console.log(`    ${f}`);

  console.log('\ndone. Scratch + probe sessions left in place for manual inspection:');
  console.log(`  ${SCRATCH}\n  ${projectDir()}`);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});

/*
 * FINDINGS — run of 2026-07-22 (SDK v0.3.217, model haiku):
 *
 *   V1: resumeSessionAt REQUIRES an assistant-message uuid. Passing a user uuid
 *       fails cleanly: result subtype error_during_execution, "No message found
 *       with message.uuid of: <uuid>". The anchor is INCLUSIVE (resumed context
 *       contained the anchored turn). A user message's parentUuid points directly
 *       at the preceding assistant text entry, so the anchor walk is: edited user
 *       entry → follow parentUuid until type === 'assistant'.
 *   V2: Rewind is IN PLACE — the resumed query keeps the SAME session id and the
 *       jsonl is NOT truncated. The new turn is APPENDED with parentUuid set to
 *       the anchor, turning the transcript into a TREE: the abandoned tail stays
 *       in the file as a dead branch. Consequence: any linear transcript reader
 *       shows both branches — history reading must follow the active parent
 *       chain backward from the last main-chain entry. (This also means CLIde
 *       currently mis-renders sessions rewound from the terminal CLI.)
 *   V3: Nonexistent anchor uuid → same clean error result as V1; no hang, no
 *       partial session damage. First-message edit has no assistant ancestor
 *       (parentUuid null) → must drop resume entirely and start fresh.
 *   V4: Moot for in-place (same sid on first streamed message). The fresh-start
 *       path relies on the existing new-session id capture.
 *   V5: enableFileCheckpointing writes file-history-snapshot / file-history-delta
 *       entries INTO the session jsonl (trackedFileBackups map); no separate
 *       storage dir appeared under ~/.claude. Disk growth is bounded to
 *       ~/.claude/projects transcripts. (Backup payload shape for modified files
 *       still TBD — Phase B concern.)
 *   V7: All real user transcript entries carry a uuid (0 missing). Metadata rows
 *       (attachment/queue-operation/last-prompt/ai-title/mode) have no uuid or no
 *       role and are not rendered as chat messages.
 *   V8 (implied by V2): the messages endpoint does NOT reflect any truncation —
 *       there is none. The branch-aware filter server-side is what makes the
 *       post-rewind refetch correct.
 */
