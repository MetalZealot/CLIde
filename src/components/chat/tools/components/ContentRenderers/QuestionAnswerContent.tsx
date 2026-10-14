import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, MessageCircleQuestion } from 'lucide-react';

import type { Question, QuestionOption } from '../../../types/types';
import type { ToolStatus } from '../ToolStatusBadge';

interface QuestionAnswerContentProps {
  questions: Question[];
  answers: Record<string, string | string[]>;
  status?: ToolStatus;
  /** A failed call's message; a denial needs none. */
  errorText?: string;
  defaultOpen?: boolean;
  className?: string;
}

// Multi-select answers arrive as one string joined with ", " (the Agent SDK's
// documented format), but a custom free-text answer can itself contain ", ".
// Split on the delimiter, then fold consecutive fragments that don't match a
// known option label back into a single custom answer.
function parseAnswerLabels(answer: string, optionLabels: Set<string>): string[] {
  const labels: string[] = [];
  let custom: string[] = [];
  const flush = () => {
    if (custom.length > 0) {
      labels.push(custom.join(', '));
      custom = [];
    }
  };
  for (const fragment of answer.split(', ')) {
    if (optionLabels.has(fragment)) {
      flush();
      labels.push(fragment);
    } else {
      custom.push(fragment);
    }
  }
  flush();
  return labels;
}

function normalizeAnswerLabels(
  answer: string | string[] | undefined,
  optionLabels: Set<string>,
  isSecret: boolean,
): string[] {
  if (answer === undefined) {
    return [];
  }
  if (isSecret) {
    const hasAnswer = Array.isArray(answer)
      ? answer.some((value) => typeof value === 'string' && value.length > 0)
      : typeof answer === 'string' && answer.length > 0;
    return hasAnswer ? ['[redacted]'] : [];
  }
  if (Array.isArray(answer)) {
    return answer.filter((value): value is string => typeof value === 'string' && value.length > 0);
  }
  return typeof answer === 'string' ? parseAnswerLabels(answer, optionLabels) : [];
}

interface AnsweredQuestion {
  question: Question;
  options: QuestionOption[];
  labels: string[];
  /** Answers that match no offered option: typed "Other" text, or a redacted secret. */
  customLabels: string[];
}

/** Keeps well-formed questions and pairs each with its answer; transcript payloads may be malformed. */
function readQuestions(questions: unknown, answers: Record<string, string | string[]>): AnsweredQuestion[] {
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((raw): AnsweredQuestion[] => {
    if (!raw || typeof raw !== 'object' || typeof raw.question !== 'string') return [];
    const question = raw as Question;
    const options = Array.isArray(question.options)
      ? question.options.filter((opt) => opt && typeof opt === 'object' && typeof opt.label === 'string')
      : [];
    const optionLabels = new Set(options.map((opt) => opt.label));
    const answer = answers?.[question.id || question.question] ?? answers?.[question.question];
    const labels = normalizeAnswerLabels(answer, optionLabels, Boolean(question.isSecret));
    const customLabels = labels.filter((label) => question.isSecret || !optionLabels.has(label));
    return [{ question, options, labels, customLabels }];
  });
}

/** Radio for single choice, checkbox for multi-select; filled when picked. */
function ChoiceMark({ picked, multi }: { picked: boolean; multi: boolean }) {
  return (
    <span
      className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border-[1.5px] ${multi ? 'rounded-[3px]' : 'rounded-full'} ${
        picked ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400' : 'border-muted-foreground/40'
      }`}
      aria-hidden
    >
      {picked && <Check className="h-2.5 w-2.5 text-white dark:text-background" strokeWidth={3.5} />}
    </span>
  );
}

/** Asked questions as a card: a one-line summary that opens to every offered option, the picked ones marked. */
export const QuestionAnswerContent: React.FC<QuestionAnswerContentProps> = ({
  questions,
  answers,
  status = 'completed',
  errorText,
  defaultOpen,
  className = '',
}) => {
  const { t } = useTranslation('chat');
  const isFailure = status === 'error';
  const [isOpen, setIsOpen] = useState(defaultOpen ?? isFailure);

  const items = readQuestions(questions, answers || {});
  if (items.length === 0) {
    return null;
  }

  const answeredCount = items.filter((item) => item.labels.length > 0).length;
  const isWaiting = status === 'running' && answeredCount === 0;
  const skippedLabel = answeredCount > 0 ? t('questions.skipped') : t('questions.notAnswered');

  let summary = '';
  if (isFailure) summary = t('questions.failed');
  else if (isWaiting) summary = t('questions.waiting');
  else if (answeredCount < items.length && items.length > 1) {
    summary = t('questions.someAnswered', { answered: answeredCount, total: items.length });
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-border/60 ${className}`} data-chat-find-content>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="block w-full select-none px-3 text-left text-chat-activity text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex min-h-10 items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="shrink-0 font-semibold">{t('questions.label', { count: items.length })}</span>
          <span className={`min-w-0 flex-1 truncate ${isFailure ? 'text-destructive' : ''}`}>{summary}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
        {/* Closed, each question shows its topic and the answer given; opening swaps these for the full options. */}
        {!isOpen && !isWaiting && (
          <span className="-mt-1 block space-y-0.5 pb-2.5 [overflow-wrap:anywhere]">
            {items.map(({ question, labels }, idx) => (
              <span key={idx} className="flex items-baseline gap-2">
                <span className="max-w-[40%] shrink-0 truncate">{question.header || question.question}</span>
                {labels.length > 0
                  ? <span className="min-w-0 flex-1 font-medium text-foreground">{labels.join(', ')}</span>
                  : <span className="min-w-0 flex-1 italic text-muted-foreground/70">{skippedLabel}</span>}
              </span>
            ))}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="space-y-3 px-3 pb-3 pt-1 text-chat-activity [overflow-wrap:anywhere]">
          {items.map(({ question, options, labels, customLabels }, idx) => {
            const multi = Boolean(question.multiSelect);
            return (
              <div key={idx}>
                {question.header && (
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{question.header}</div>
                )}
                <div className="text-foreground">{question.question}</div>
                <div className="mt-1 space-y-1">
                  {options.map((option) => {
                    const picked = labels.includes(option.label);
                    return (
                      <div key={option.label} className="flex items-start gap-2">
                        <ChoiceMark picked={picked} multi={multi} />
                        <div className="min-w-0 flex-1">
                          <div className={picked ? 'font-medium text-foreground' : 'text-muted-foreground'}>{option.label}</div>
                          {option.description && (
                            <div className="text-chat-meta text-muted-foreground/80">{option.description}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {customLabels.map((label) => (
                    <div key={label} className="flex items-start gap-2">
                      <ChoiceMark picked multi={multi} />
                      <div className="min-w-0 flex-1 font-medium text-foreground">
                        {label}
                        {!question.isSecret && (
                          <span className="ml-1.5 text-chat-meta font-normal text-muted-foreground">{t('questions.yourAnswer')}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {labels.length === 0 && !isWaiting && (
                    <div className="italic text-muted-foreground/70">{skippedLabel}</div>
                  )}
                </div>
              </div>
            );
          })}

          {errorText && <div className="text-destructive [overflow-wrap:anywhere]">{errorText}</div>}
        </div>
      )}
    </div>
  );
};
