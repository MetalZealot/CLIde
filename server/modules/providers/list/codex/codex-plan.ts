import fsp from 'node:fs/promises';

import type { SessionPlan, SessionPlanStep } from '@/shared/types.js';

/** Codex's `update_plan` arguments and the App Server's `turn/plan/updated` params share one shape. */
export function codexPlanFrom(value: unknown): SessionPlan | null {
  const plan = (value as { plan?: unknown } | null)?.plan;
  if (!Array.isArray(plan)) return null;
  const steps = plan.flatMap((item, index): SessionPlanStep[] => {
    const subject = typeof item?.step === 'string' ? item.step.trim() : '';
    if (!subject) return [];
    const status = item.status === 'completed'
      ? 'completed'
      : item.status === 'in_progress' || item.status === 'inProgress' ? 'in_progress' : 'pending';
    return [{ id: String(index + 1), subject, status }];
  });
  return steps.length ? { steps } : null;
}

/** Each `update_plan` call restates the whole plan, so the last one in the rollout is current. */
export async function readCodexPlan(jsonlPath: string | null | undefined): Promise<SessionPlan | null> {
  if (!jsonlPath) return null;
  let text: string;
  try {
    text = await fsp.readFile(jsonlPath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes('"update_plan"')) continue;
    try {
      const payload = JSON.parse(lines[index])?.payload;
      if (payload?.type !== 'function_call' || payload.name !== 'update_plan') continue;
      return codexPlanFrom(JSON.parse(payload.arguments));
    } catch {
      // A torn final line is skipped; the one before it still holds a whole plan.
    }
  }
  return null;
}
