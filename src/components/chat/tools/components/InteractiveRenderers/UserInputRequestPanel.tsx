import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Question } from '../../../types/types';

import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';

import { adaptUserInputAnswers } from './user-input-request.adapter';

type NormalizedQuestion = Question & {
  id: string;
  options: NonNullable<Question['options']>;
  allowOther: boolean;
  isSecret: boolean;
};

function normalizeQuestions(request: PermissionPanelProps['request']): NormalizedQuestion[] {
  const input = request.input as { questions?: Question[] } | undefined;
  const source = Array.isArray(request.questions)
    ? request.questions
    : Array.isArray(input?.questions)
      ? input.questions
      : [];

  return source.flatMap((question, index) => {
    if (!question || typeof question.question !== 'string' || !question.question.trim()) {
      return [];
    }
    const id = typeof question.id === 'string' && question.id.trim()
      ? question.id
      : question.question;
    const options = Array.isArray(question.options)
      ? question.options.filter((option) =>
          option
          && typeof option.label === 'string'
          && option.label.trim().length > 0
        )
      : [];

    return [{
      ...question,
      id: id || `question-${index + 1}`,
      options,
      // Claude's legacy picker always offered Other. Codex supplies isOther
      // explicitly and normalizes it to allowOther.
      allowOther: question.allowOther ?? request.provider !== 'codex',
      isSecret: Boolean(question.isSecret),
      // Codex questions have no multi-select marker; default to one selection.
      multiSelect: Boolean(question.multiSelect),
    }];
  });
}

function readExpiry(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRequestExpiry(
  isBlocking: boolean | undefined,
  expiresAt: Date | string | null | undefined,
): number | null {
  return isBlocking === true ? null : readExpiry(expiresAt);
}

export const UserInputRequestPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const questions = useMemo(() => normalizeQuestions(request), [request]);
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<string, Set<string>>>(() => new Map());
  const [freeText, setFreeText] = useState<Map<string, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Set<string>>(() => new Set());
  const [remainingMs, setRemainingMs] = useState<number | null>(() => {
    const expiry = readRequestExpiry(request.isBlocking, request.expiresAt);
    return expiry === null ? null : Math.max(0, expiry - Date.now());
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const q = questions[currentStep];
  const isFreeTextOnly = Boolean(q && q.options.length === 0);
  const isOtherOn = Boolean(q && (isFreeTextOnly || otherActive.has(q.id)));

  useEffect(() => {
    const expiry = readRequestExpiry(request.isBlocking, request.expiresAt);
    if (expiry === null) {
      setRemainingMs(null);
      return;
    }
    const update = () => setRemainingMs(Math.max(0, expiry - Date.now()));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [request.expiresAt, request.isBlocking]);

  useEffect(() => {
    if (isOtherOn) {
      textInputRef.current?.focus();
    } else {
      containerRef.current?.focus();
    }
  }, [currentStep, isOtherOn]);

  const toggleOption = useCallback((question: NormalizedQuestion, label: string) => {
    setSelections((previous) => {
      const next = new Map(previous);
      const current = new Set(next.get(question.id) || []);
      if (question.multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive((active) => {
          const updated = new Set(active);
          updated.delete(question.id);
          return updated;
        });
      }
      next.set(question.id, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((question: NormalizedQuestion) => {
    setOtherActive((previous) => {
      const next = new Set(previous);
      if (next.has(question.id)) {
        next.delete(question.id);
      } else {
        next.add(question.id);
        if (!question.multiSelect) {
          setSelections((currentSelections) => {
            const updated = new Map(currentSelections);
            updated.set(question.id, new Set());
            return updated;
          });
        }
      }
      return next;
    });
  }, []);

  const buildAnswers = useCallback((): Record<string, string[]> => {
    const answers: Record<string, string[]> = {};
    for (const question of questions) {
      const values = Array.from(selections.get(question.id) || []);
      const custom = (freeText.get(question.id) || '').trim();
      if ((question.options.length === 0 || otherActive.has(question.id)) && custom) {
        values.push(custom);
      }
      if (values.length > 0) {
        answers[question.id] = values;
      }
    }
    return answers;
  }, [freeText, otherActive, questions, selections]);

  const submit = useCallback((answers: Record<string, string[]>) => {
    const input = request.input && typeof request.input === 'object'
      ? request.input as Record<string, unknown>
      : {};

    // Claude's Agent SDK keys answers by question text and expects one
    // comma-delimited string. Codex keys by stable id and requires arrays.
    onDecision(request.requestId, {
      requestType: 'user_input',
      decision: 'allow_once',
      answers,
      allow: true,
      updatedInput: {
        ...input,
        answers: adaptUserInputAnswers(request.provider, questions, answers),
      },
      toolId: request.toolId,
    });
  }, [onDecision, questions, request]);

  const handleSubmit = useCallback(() => submit(buildAnswers()), [buildAnswers, submit]);
  const handleSkip = useCallback(() => submit({}), [submit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!q || event.target instanceof HTMLInputElement) {
      return;
    }
    const number = Number.parseInt(event.key, 10);
    if (number >= 1 && number <= q.options.length) {
      event.preventDefault();
      toggleOption(q, q.options[number - 1].label);
      return;
    }
    if (event.key === '0' && q.allowOther) {
      event.preventDefault();
      toggleOther(q);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (currentStep === questions.length - 1) handleSubmit();
      else setCurrentStep((step) => step + 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handleSkip();
    }
  }, [currentStep, handleSkip, handleSubmit, q, questions.length, toggleOption, toggleOther]);

  if (!q) {
    return null;
  }

  const selected = selections.get(q.id) || new Set<string>();
  const customValue = freeText.get(q.id) || '';
  const isLast = currentStep === questions.length - 1;
  const canSubmit = Object.keys(buildAnswers()).length > 0;
  const providerName = request.provider === 'codex' ? 'Codex' : 'Claude';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="w-full outline-none"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {providerName} needs your input
            </span>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {remainingMs !== null && (
                <span aria-live="polite">
                  {remainingMs > 0 ? `Skips in ${Math.ceil(remainingMs / 1000)}s` : 'Resolving…'}
                </span>
              )}
              {questions.length > 1 && (
                <span>{currentStep + 1}/{questions.length}</span>
              )}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {q.header && (
              <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                {q.header}
              </span>
            )}
            {q.multiSelect && (
              <span className="text-[10px] text-muted-foreground">Select all that apply</span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium leading-snug text-foreground">{q.question}</p>
        </div>

        <div
          className="max-h-56 space-y-1 overflow-y-auto px-4 py-3"
          role={q.multiSelect ? 'group' : 'radiogroup'}
          aria-label={q.question}
        >
          {q.options.map((option, index) => {
            const active = selected.has(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={active}
                onClick={() => toggleOption(q, option.label)}
                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950'
                    : 'border-border hover:bg-muted/60'
                }`}
              >
                <kbd className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted font-mono text-[10px] text-muted-foreground">
                  {index + 1}
                </kbd>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {q.allowOther && q.options.length > 0 && (
            <button
              type="button"
              aria-pressed={isOtherOn}
              onClick={() => toggleOther(q)}
              className={`flex w-full items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-left ${
                isOtherOn ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950' : 'border-border'
              }`}
            >
              <kbd className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted font-mono text-[10px] text-muted-foreground">
                0
              </kbd>
              <span className="text-[13px] text-foreground">Other…</span>
            </button>
          )}

          {isOtherOn && (
            <input
              ref={textInputRef}
              type={q.isSecret ? 'password' : 'text'}
              autoComplete={q.isSecret ? 'new-password' : 'off'}
              value={customValue}
              onChange={(event) => {
                const value = event.target.value;
                setFreeText((previous) => {
                  const next = new Map(previous);
                  next.set(q.id, value);
                  return next;
                });
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (isLast) handleSubmit();
                  else setCurrentStep((step) => step + 1);
                }
              }}
              aria-label={q.question}
              placeholder={q.isSecret ? 'Enter secret…' : 'Type your answer…'}
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-blue-400"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {questions.length === 1 ? 'Skip' : 'Skip all'} <span className="text-[9px]">Esc</span>
          </button>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep((step) => step - 1)}
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? handleSubmit : () => setCurrentStep((step) => step + 1)}
              disabled={isLast && !canSubmit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLast ? 'Submit' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Import compatibility for extensions that registered the old Claude-specific
// name directly.
export const AskUserQuestionPanel = UserInputRequestPanel;
