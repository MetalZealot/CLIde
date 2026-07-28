/**
 * verify-context-usage-sdk.ts — empirical probe of the Agent SDK's
 * `Query.getContextUsage()` control request.
 *
 * Run from the repo root (uses the repo's installed SDK + the user's Claude login;
 * costs two one-word turns):
 *
 *   npx tsx scripts/verify-context-usage-sdk.ts
 *
 * Answers the feasibility questions for driving the context ring off the SDK
 * instead of reconstructing it from JSONL (TODO "Drive the context ring from
 * the SDK's getContextUsage()"):
 *
 *   C1 — does the control request work when `prompt` is a bare STRING? The SDK
 *        documents control requests as "only supported when streaming
 *        input/output is used", and server/claude-sdk.js passes a string for
 *        every text-only turn. If this fails, the feature needs the whole send
 *        path moved to streaming input.
 *   C2 — WHEN can it be called? Inside the loop on the terminal `result`
 *        message, versus after the generator has finished (the query instance
 *        CLIde currently drops via removeSession).
 *   C3 — what is `maxTokens` / `rawMaxTokens`, and does `maxTokens` agree with
 *        the hand-derived ceiling from resolveClaudeContextCeiling?
 *   C4 — are `autoCompactThreshold` / `isAutoCompactEnabled` populated, i.e. can
 *        the ring mark where auto-compact fires?
 *   C5 — does `totalTokens` agree with what extractTokenBudget reports as
 *        `used` for the same turn?
 *   C6 — how long does the round trip take (it would run once per turn)?
 *
 * Both probe turns run in a scratch cwd, so they create a real transcript under
 * ~/.claude/projects/-tmp-context-usage-probe — delete it when finished.
 *
 * FINDINGS (recorded after the run) — see the trailing "FINDINGS" comment block.
 */

/*
 * FINDINGS — run 2026-07-27, SDK 0.3.220, one turn per model.
 *
 * C1 — YES, a bare string prompt works. Despite the "only supported when
 *      streaming input/output is used" wording on the Query control-request
 *      block, getContextUsage() resolved fine against the string-prompt
 *      transport CLIde already uses. No migration of the send path needed.
 *
 * C2 — TIMING is the real constraint, not the prompt shape:
 *          at system/init  -> OK (1082-1200ms)
 *          at assistant    -> OK (779-1121ms)
 *          at result       -> "Query closed before response received"
 *          after the loop  -> "ProcessTransport is not ready for writing"
 *      So it must be called mid-turn. The terminal `result` message is already
 *      too late: the transport is closing by the time it is yielded.
 *
 * C3 — the SDK's maxTokens DISAGREES with resolveClaudeContextCeiling, in both
 *      directions:
 *          haiku  (claude-haiku-4-5-20251001): SDK 200000, derived 180000
 *          sonnet (claude-sonnet-5):           SDK 967000, derived 980000
 *      i.e. Claude Code does NOT subtract an output reserve from a 200K window,
 *      and takes 33000 off the 1M window (registry `context.window` for
 *      claude-sonnet-5 really is 1e6 — verified in sdk.mjs). rawMaxTokens
 *      equalled maxTokens in both runs.
 *
 * C4 — YES: isAutoCompactEnabled true, autoCompactThreshold populated, and in
 *      both runs threshold === maxTokens - 33000 (haiku 167000, sonnet 934000).
 *      33000 also shows up as sonnet's "Autocompact buffer" category. So
 *      auto-compact IS enabled for SDK sessions, and the point where it fires
 *      is knowable.
 *
 * C5 — totalTokens tracks the stream numerator to within a handful of tokens
 *      (20003 vs 20106, 26878 vs 26879). extractTokenBudget's numerator is
 *      already right; it is the denominator that was wrong.
 *
 * C6 — 780-1200ms per round trip. Fine once per turn, far too slow to run per
 *      assistant frame, and it must not be awaited inline in the message loop.
 */

import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeExecutablePath } from '../server/shared/claude-cli-path.js';
import { resolveClaudeContextCeiling } from '../server/modules/providers/list/claude/claude-context-window.js';

const SCRATCH = '/tmp/context-usage-probe';

// One 200K-class model and one 1M-class model: the gap between them is the
// whole point of the model-derived ceiling, so both need checking.
const MODELS = ['haiku', 'sonnet'];

type Attempt = { site: string; ms: number; error: string | null };

type Probe = {
  model: string;
  attempts: Attempt[];
  atResult: unknown;
  atResultMs: number | null;
  atResultError: string | null;
  afterLoop: unknown;
  afterLoopError: string | null;
  streamUsed: number | null;
  sessionId: string | null;
};

const summarize = (usage: any) => {
  if (!usage || typeof usage !== 'object') return usage;
  return {
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    rawMaxTokens: usage.rawMaxTokens,
    percentage: usage.percentage,
    model: usage.model,
    autoCompactThreshold: usage.autoCompactThreshold,
    isAutoCompactEnabled: usage.isAutoCompactEnabled,
    categories: Array.isArray(usage.categories)
      ? usage.categories.map((c: any) => `${c.name}=${c.tokens}`)
      : undefined,
    memoryFiles: Array.isArray(usage.memoryFiles) ? usage.memoryFiles.length : undefined,
    mcpTools: Array.isArray(usage.mcpTools) ? usage.mcpTools.length : undefined,
    messageBreakdown: usage.messageBreakdown,
  };
};

async function probe(model: string): Promise<Probe> {
  const out: Probe = {
    model,
    attempts: [],
    atResult: null,
    atResultMs: null,
    atResultError: null,
    afterLoop: null,
    afterLoopError: null,
    streamUsed: null,
    sessionId: null,
  };

  // Deliberately a bare string, exactly like buildPromptPayload's text-only path.
  const q = query({
    prompt: 'Reply with the single word OK and nothing else.',
    options: {
      env: { ...process.env },
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
      cwd: SCRATCH,
      model,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
      settingSources: ['project', 'user', 'local'] as ('project' | 'user' | 'local')[],
      allowedTools: [] as string[],
    },
  });

  for await (const message of q as AsyncIterable<Record<string, any>>) {
    if (typeof message.session_id === 'string') out.sessionId = message.session_id;

    // Mirror extractTokenBudget's numerator so C5 compares like with like.
    const usage = message.message?.usage;
    if (usage && message.type !== 'result') {
      const input =
        Number(usage.input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0);
      if (input > 0) out.streamUsed = input + Number(usage.output_tokens ?? 0);
    }

    // Try every plausible call site in one turn: the init frame, the first
    // assistant frame, and the terminal result.
    const site =
      message.type === 'system' && message.subtype === 'init' ? 'init'
        : message.type === 'assistant' ? 'assistant'
          : message.type === 'result' ? 'result'
            : null;

    if (site && !out.attempts.some((a) => a.site === site)) {
      const started = Date.now();
      try {
        const usage = await q.getContextUsage();
        out.attempts.push({ site, ms: Date.now() - started, error: null });
        out.atResult = usage;
      } catch (error: any) {
        out.attempts.push({ site, ms: Date.now() - started, error: error?.message ?? String(error) });
      }
    }
  }

  // C2: the generator has returned — this is the state CLIde is in once a turn
  // ends and removeSession drops the instance.
  try {
    out.afterLoop = await q.getContextUsage();
  } catch (error: any) {
    out.afterLoopError = error?.message ?? String(error);
  }

  return out;
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });

  for (const model of MODELS) {
    const result = await probe(model);
    const atResult: any = result.atResult;

    console.log(`\n=== ${model} ===`);
    console.log('session:', result.sessionId);
    for (const attempt of result.attempts) {
      console.log(`C1/C2 at ${attempt.site}:`, attempt.error ?? `OK (${attempt.ms}ms)`);
    }
    console.log('C2 after loop:', result.afterLoopError ?? 'OK');
    console.log('payload:', JSON.stringify(summarize(atResult), null, 2));

    if (atResult && typeof atResult === 'object') {
      const derived = resolveClaudeContextCeiling({ model: atResult.model ?? model });
      console.log('C3 resolveClaudeContextCeiling says:', derived,
        '| SDK maxTokens:', atResult.maxTokens,
        '| SDK rawMaxTokens:', atResult.rawMaxTokens,
        derived === atResult.maxTokens ? '— MATCH' : '— DIFFERENT');
      console.log('C5 stream used:', result.streamUsed, '| SDK totalTokens:', atResult.totalTokens);
    }
  }

  console.log(`\nScratch transcript lives under ~/.claude/projects/${SCRATCH.replace(/\//g, '-')} — delete it.`);
}

main().catch((error) => {
  console.error('probe failed:', error);
  process.exitCode = 1;
});
