/**
 * Empirical probe of the Agent SDK's `Query.getContextUsage()` control request.
 * Run from the repo root; uses the installed SDK and the user's Claude login,
 * and costs two one-word turns:
 *
 *   npx tsx scripts/verify-context-usage-sdk.ts
 *
 * Questions, for driving the context ring off the SDK instead of reconstructing
 * it from JSONL:
 *
 *   C1 — does the control request work with a bare STRING prompt? The SDK
 *        documents control requests as streaming-only, and the Claude runtime
 *        passes a string for every text-only turn.
 *   C2 — WHEN can it be called: inside the loop, on the terminal `result`, or
 *        after the generator finishes?
 *   C3 — what are `maxTokens` / `rawMaxTokens`, and do they agree with
 *        resolveClaudeContextCeiling?
 *   C4 — are `autoCompactThreshold` / `isAutoCompactEnabled` populated?
 *   C5 — does `totalTokens` agree with extractTokenBudget's `used`?
 *   C6 — how long is the round trip?
 *
 * Both turns run in a scratch cwd, creating a real transcript under
 * ~/.claude/projects/-tmp-context-usage-probe — delete it when finished.
 */

/*
 * FINDINGS — run 2026-07-27, SDK 0.3.220, one turn per model.
 *
 * C1 — YES. Despite the streaming-only wording, getContextUsage() resolved
 *      against the string-prompt transport already in use.
 *
 * C2 — TIMING is the constraint, not prompt shape:
 *          at system/init  -> OK (1082-1200ms)
 *          at assistant    -> OK (779-1121ms)
 *          at result       -> "Query closed before response received"
 *          after the loop  -> "ProcessTransport is not ready for writing"
 *      Mid-turn only; the terminal `result` is already too late.
 *
 * C3 — maxTokens DISAGREES with resolveClaudeContextCeiling, both directions:
 *          haiku  (claude-haiku-4-5-20251001): SDK 200000, derived 180000
 *          sonnet (claude-sonnet-5):           SDK 967000, derived 980000
 *      So no output reserve is taken off a 200K window, and 33000 off the 1M
 *      window (registry `context.window` for sonnet really is 1e6, verified in
 *      sdk.mjs). rawMaxTokens equalled maxTokens in both runs.
 *
 * C4 — YES: isAutoCompactEnabled true, and threshold === maxTokens - 33000 in
 *      both runs (haiku 167000, sonnet 934000). 33000 also appears as sonnet's
 *      "Autocompact buffer" category.
 *
 * C5 — totalTokens tracks the stream numerator to within a few tokens (20003 vs
 *      20106, 26878 vs 26879). The numerator was already right; the denominator
 *      was wrong.
 *
 * C6 — 780-1200ms. Fine once per turn, far too slow per assistant frame, and it
 *      must not be awaited inline in the message loop.
 */

/*
 * RE-RUN — 2026-08-17, SDK 0.3.233, runtime 2.1.233, one turn per model.
 * Ran from a CLIde-hosted shell, so the probe inherited that session's
 * CLAUDE_CODE_* environment; CLAUDE_CODE_DISABLE_1M_CONTEXT was not set.
 *
 * C1/C2 — UNCHANGED, and this is the constraint to design around. Mid-turn only:
 *             at system/init  -> OK (939ms haiku, 951ms sonnet)
 *             at assistant    -> OK (863ms haiku, 917ms sonnet)
 *             at result       -> "Query closed before response received"
 *             after the loop  -> "ProcessTransport is not ready for writing"
 *         An idle surface cannot pull a control request on demand. Anything that
 *         wants this data outside a turn must capture it during one and cache.
 *
 * C3 — NOW MATCHES, both models: SDK maxTokens === rawMaxTokens ===
 *      resolveClaudeContextCeiling === 200000, for haiku AND claude-sonnet-5.
 *      The 2026-07-27 run disagreed in both directions (haiku 200000/180000,
 *      sonnet 967000/980000). Two things moved: the derived side was refreshed
 *      from the new registry with the 1M env var honored (`a3d7aac2`), and the
 *      SDK now reports 200000 for sonnet rather than 967000. The second is this
 *      host's own setting, not an SDK change — `~/.claude/settings.json` sets
 *      `autoCompactWindow: 200000`, so the runtime clamps its reported window.
 *      Read this as agreement on this host, not as "1M is gone".
 *
 *      2026-08-18, re-run with CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 against
 *      claude-sonnet-5 (registry window 1e6): maxTokens 200000, rawMaxTokens
 *      200000. A cap collapses BOTH, so no field of this response reveals the
 *      model's uncapped window or that a cap is in force. Anything wanting to
 *      show "capped at X of Y" must read the env var and settings.json itself
 *      and take Y from the registry table.
 *
 * C4 — unchanged: isAutoCompactEnabled true, threshold === maxTokens - 33000
 *      (167000 for both models this run).
 *
 * C5 — still agrees to within a few tokens (21991 vs 21987, 29422 vs 29421).
 *
 * C6 — 863-951ms, same band as before.
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
