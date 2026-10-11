import { useEffect, useMemo, useState } from 'react';

import type { NormalizedMessage, SessionPlan, SessionPlanStep } from '../../../stores/useSessionStore';
import { authenticatedFetch } from '../../../utils/api';

/** Calls that change a plan the provider stores on disk, so it is read back after each. */
const STORED_PLAN_TOOLS = new Set(['TaskCreate', 'TaskUpdate']);

const parseInput = (input: unknown): any => {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

/** Claude's `TodoWrite` and Codex's SDK todo list restate the whole plan in one call. */
export function planFromListCall(toolName: string | undefined, toolInput: unknown): SessionPlan | null {
  const input = parseInput(toolInput);
  let steps: SessionPlanStep[] = [];
  if (toolName === 'TodoWrite' && Array.isArray(input?.todos)) {
    steps = input.todos.flatMap((todo: any, index: number): SessionPlanStep[] => (typeof todo?.content === 'string' && todo.content
      ? [{
        id: String(index + 1),
        subject: todo.content,
        status: todo.status === 'completed' || todo.status === 'in_progress' ? todo.status : 'pending',
        ...(typeof todo.activeForm === 'string' && todo.activeForm ? { activeForm: todo.activeForm } : {}),
      }]
      : []));
  } else if (toolName === 'TodoList' && Array.isArray(input?.items)) {
    steps = input.items.flatMap((item: any, index: number): SessionPlanStep[] => (typeof item?.text === 'string' && item.text
      ? [{ id: String(index + 1), subject: item.text, status: item.completed ? 'completed' : 'pending' }]
      : []));
  }
  return steps.length ? { steps } : null;
}

export type PlanSignals = {
  /** Bumps each time a stored-plan call finishes, so the stored plan is read again. */
  revision: number;
  /** A plan the transcript states outright, when that is the latest word on it. */
  stated: SessionPlan | null;
};

export function readPlanSignals(records: NormalizedMessage[]): PlanSignals {
  let revision = 0;
  let stated: SessionPlan | null = null;
  const storedCalls = new Set<string>();
  for (const record of records) {
    if (record.kind === 'tool_use' && record.toolId && STORED_PLAN_TOOLS.has(String(record.toolName))) {
      storedCalls.add(record.toolId);
      if (record.toolResult) {
        revision += 1;
        stated = null;
      }
    } else if (record.kind === 'tool_result' && record.toolId && storedCalls.has(record.toolId)) {
      revision += 1;
      stated = null;
    } else if (record.kind === 'tool_use') {
      stated = planFromListCall(record.toolName, record.toolInput) ?? stated;
    } else if (record.kind === 'plan_updated' && record.plan) {
      stated = record.plan;
    }
  }
  return { revision, stated };
}

/** The session's plan: the provider's stored copy, unless the transcript has stated a newer one. */
export function useSessionPlan(sessionId: string | null, records: NormalizedMessage[]): SessionPlan | null {
  const { revision, stated } = useMemo(() => readPlanSignals(records), [records]);
  const [stored, setStored] = useState<{ sessionId: string; plan: SessionPlan | null } | null>(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    // A finished call can land a beat before its file does.
    const timer = setTimeout(() => {
      authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/plan`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!cancelled) setStored({ sessionId, plan: body?.data?.plan ?? null });
        })
        .catch(() => undefined);
    }, revision ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, revision]);

  if (stated) return stated;
  return stored?.sessionId === sessionId ? stored.plan : null;
}
