import { createContext, useEffect, useMemo, useState } from 'react';

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

/** Codex history keeps each `update_plan` call, which restates the whole plan as `{ plan: [{ step, status }] }`. */
function planFromCodexCall(toolInput: unknown): SessionPlan | null {
  const items = parseInput(toolInput)?.plan;
  if (!Array.isArray(items)) return null;
  const steps = items.flatMap((item: any, index: number): SessionPlanStep[] => {
    const subject = typeof item?.step === 'string' ? item.step.trim() : '';
    if (!subject) return [];
    const status = item.status === 'completed' ? 'completed' : item.status === 'in_progress' || item.status === 'inProgress' ? 'in_progress' : 'pending';
    return [{ id: String(index + 1), subject, status }];
  });
  return steps.length ? { steps } : null;
}

type ResultLike = { content?: unknown; isError?: boolean; toolUseResult?: unknown } | null | undefined;

/** The id Claude gave a created task: structured output first, else its "Task #N created" text. */
function createdTaskId(result: ResultLike): string | null {
  const structured = (result?.toolUseResult as { task?: { id?: unknown } } | undefined)?.task?.id;
  if (structured !== undefined && structured !== null && String(structured)) return String(structured);
  const match = /Task #(\w+)/.exec(typeof result?.content === 'string' ? result.content : '');
  return match ? match[1] : null;
}

/**
 * Each plan the transcript shows finishing, keyed by the record that finished it. A step created on an
 * unloaded page has an empty subject; `namedFinishedPlan` fills it or drops the card.
 */
export function findFinishedPlans(records: NormalizedMessage[]): Map<NormalizedMessage, SessionPlan> {
  const finished = new Map<NormalizedMessage, SessionPlan>();
  const results = new Map<string, ResultLike>();
  for (const record of records) {
    if (record.kind === 'tool_result' && record.toolId) results.set(record.toolId, (record.toolResult ?? record) as ResultLike);
  }

  type Step = { subject: string | null; status: SessionPlanStep['status']; activeForm?: string };
  let steps = new Map<string, Step>();
  let isStored = false;
  let wasDone = false;
  const isDone = () => steps.size > 0 && [...steps.values()].every((step) => step.status === 'completed');

  for (const record of records) {
    if (record.parentToolUseId) continue;
    const name = String(record.toolName ?? '');
    let changed = false;
    if (record.kind === 'plan_updated' || (record.kind === 'tool_use' && !STORED_PLAN_TOOLS.has(name))) {
      const plan = record.kind === 'plan_updated'
        ? record.plan ?? null
        : name === 'update_plan' ? planFromCodexCall(record.toolInput) : planFromListCall(name, record.toolInput);
      if (!plan) continue;
      steps = new Map(plan.steps.map((step) => [step.id, { subject: step.subject, status: step.status, activeForm: step.activeForm }]));
      isStored = false;
      changed = true;
    } else if (record.kind === 'tool_use' && record.toolId) {
      const result = record.toolResult ?? results.get(record.toolId);
      if (result?.isError) continue;
      const input = parseInput(record.toolInput);
      if (name === 'TaskCreate') {
        // A task created after a finished plan, or after a whole-list plan, starts the next plan.
        if (!isStored || isDone()) steps = new Map();
        isStored = true;
        const id = createdTaskId(result) ?? String(steps.size + 1);
        steps.set(id, { subject: typeof input?.subject === 'string' && input.subject ? input.subject : null, status: 'pending', activeForm: input?.activeForm });
        changed = true;
      } else if (name === 'TaskUpdate' && input?.taskId !== undefined) {
        const id = String(input.taskId);
        if (input.status === 'deleted') {
          steps.delete(id);
        } else {
          const step = steps.get(id) ?? { subject: null, status: 'pending' as const };
          if (typeof input.subject === 'string' && input.subject) step.subject = input.subject;
          if (input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed') step.status = input.status;
          steps.set(id, step);
        }
        isStored = true;
        changed = true;
      }
    }
    if (!changed) continue;
    const done = isDone();
    if (done && !wasDone) {
      finished.set(record, {
        steps: [...steps].map(([id, step]) => ({ id, subject: step.subject ?? '', status: step.status, ...(step.activeForm ? { activeForm: step.activeForm } : {}) })),
      });
    }
    wasDone = done;
  }
  return finished;
}

/**
 * A finished plan with every step named: its own steps, else the session's stored plan when that is the same
 * plan finished. Only the newest card may borrow, since the provider stores just the latest plan.
 */
export function namedFinishedPlan(card: SessionPlan, stored: SessionPlan | null | undefined): SessionPlan | null {
  if (card.steps.every((step) => step.subject)) return card;
  if (!stored?.steps.length || !stored.steps.every((step) => step.status === 'completed')) return null;
  const storedSubjects = new Map(stored.steps.map((step) => [step.id, step.subject]));
  const matches = card.steps.every((step) => storedSubjects.has(step.id) && (!step.subject || step.subject === storedSubjects.get(step.id)));
  return matches ? stored : null;
}

/** The newest finished card's id and its named plan, so that card can show steps its page lacks. */
export const NewestFinishedPlanContext = createContext<{ id: string; plan: SessionPlan } | null>(null);

/** Same steps in the same order, so a finished plan in the chat can stand in for the banner. */
export function isSamePlan(a: SessionPlan | null | undefined, b: SessionPlan | null | undefined): boolean {
  if (!a || !b || a.steps.length !== b.steps.length) return false;
  return a.steps.every((step, index) => step.subject === b.steps[index].subject);
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
