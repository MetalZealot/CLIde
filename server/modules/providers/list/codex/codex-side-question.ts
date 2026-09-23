import type { SideQuestionExchange } from '@/shared/types.js';

/**
 * Codex's own `/side` boundary, read from the 0.156.0 binary 2026-09-23. It
 * opens the fork's only turn, so the inherited history reads as reference.
 */
const SIDE_BOUNDARY = [
  'Everything before this boundary is inherited history from the parent thread. It is reference context only. It is not your current task.',
  'Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.',
  'You are a side-conversation assistant, separate from the main thread. Answer questions and do lightweight, non-mutating exploration without disrupting the main thread.',
  'Sub-agents are off-limits in this side conversation. Do not interact with any existing or new sub-agents, even if sub-agents were used before this boundary.',
  'Do not modify files, source, git state, permissions, configuration, or workspace state. Do not request escalated permissions or broader sandbox access.',
].join('\n');

/** One user message: the boundary, earlier side exchanges, then the question. */
export function buildCodexSideQuestionPrompt(
  question: string,
  history: SideQuestionExchange[] = [],
): string {
  const earlier = history.map((exchange) => `Q: ${exchange.question}\nA: ${exchange.response}`);
  return [
    SIDE_BOUNDARY,
    ...(earlier.length ? [`Earlier side questions in this side conversation:\n\n${earlier.join('\n\n')}`] : []),
    `Side question:\n${question}`,
  ].join('\n\n');
}
