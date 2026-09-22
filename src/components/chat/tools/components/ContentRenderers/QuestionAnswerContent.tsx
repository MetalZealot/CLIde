import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { Question } from '../../../types/types';
import { DetailPanel } from '../../../view/subcomponents/DetailPanel';

interface QuestionAnswerContentProps {
  questions: Question[];
  answers: Record<string, string | string[]>;
  /** A failed call's message; a denial needs none. */
  errorText?: string;
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

/** Asked questions and the answers given, flat, with no tool name or disclosure. */
export const QuestionAnswerContent: React.FC<QuestionAnswerContentProps> = ({
  questions,
  answers,
  errorText,
  className = '',
}) => {
  const { t } = useTranslation('chat');

  // Tool inputs are runtime data loaded from session transcripts and may be
  // malformed (e.g. `questions` arriving as a non-array). Guard with
  // Array.isArray so a single bad payload can't crash the whole chat view
  // with "e.map is not a function".
  if (!Array.isArray(questions) || questions.length === 0) {
    return null;
  }

  const hasAnyAnswer = Object.keys(answers || {}).length > 0;

  return (
    <DetailPanel className={`text-[13px] leading-5 sm:text-sm ${className}`}>
      {questions.map((rawQuestion, idx) => {
        // Entries come from session transcripts and may be malformed; skip
        // anything that isn't a proper question object with a string prompt.
        if (!rawQuestion || typeof rawQuestion !== 'object' || typeof rawQuestion.question !== 'string') {
          return null;
        }
        const q = rawQuestion;
        const answer = answers?.[q.id || q.question] ?? answers?.[q.question];
        // `options` is typed as an array but comes from untrusted runtime data;
        // keep only valid entries so `.map` below never throws.
        const options = Array.isArray(q.options)
          ? q.options.filter((opt) => opt && typeof opt === 'object' && typeof opt.label === 'string')
          : [];
        const answerLabels = normalizeAnswerLabels(
          answer,
          new Set(options.map((o) => o.label)),
          Boolean(q.isSecret),
        );

        return (
          <div key={idx} className={`[overflow-wrap:anywhere] ${idx > 0 ? 'mt-2' : ''}`}>
            <div className="text-muted-foreground">{q.question}</div>
            {answerLabels.length > 0 ? (
              <div className="text-foreground">
                {answerLabels.map((label, labelIdx) => (
                  <Fragment key={label}>
                    {labelIdx > 0 && ', '}
                    <span>{label}</span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <div className="italic text-muted-foreground/70">
                {hasAnyAnswer ? t('questions.skipped') : t('questions.notAnswered')}
              </div>
            )}
          </div>
        );
      })}

      {errorText && <div className="mt-2 text-red-600 [overflow-wrap:anywhere] dark:text-red-400">{errorText}</div>}
    </DetailPanel>
  );
};
