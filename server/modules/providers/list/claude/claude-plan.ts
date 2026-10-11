import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SessionPlan, SessionPlanStep } from '@/shared/types.js';

/** Claude Code keeps one JSON file per task, in a folder named by its own session id. */
export const claudeTaskListDir = (providerSessionId: string): string => path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'tasks',
  providerSessionId,
);

const LIVE_STATUSES = new Set<SessionPlanStep['status']>(['pending', 'in_progress', 'completed']);

export async function readClaudePlan(
  providerSessionId: string,
  directory: string = claudeTaskListDir(providerSessionId),
): Promise<SessionPlan | null> {
  // The id becomes a path segment.
  if (!/^[\w-]+$/.test(providerSessionId)) return null;
  let names: string[];
  try {
    names = await fsp.readdir(directory);
  } catch {
    return null;
  }

  const steps: SessionPlanStep[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const task = JSON.parse(await fsp.readFile(path.join(directory, name), 'utf8'));
      // A deleted task keeps its file with a status the plan does not show.
      if (!LIVE_STATUSES.has(task?.status) || typeof task.subject !== 'string' || !task.subject) continue;
      steps.push({
        id: String(task.id ?? name.slice(0, -'.json'.length)),
        subject: task.subject,
        status: task.status,
        ...(typeof task.activeForm === 'string' && task.activeForm ? { activeForm: task.activeForm } : {}),
      });
    } catch {
      // A file caught mid-write is read again on the next change.
    }
  }
  steps.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  return steps.length ? { steps } : null;
}
