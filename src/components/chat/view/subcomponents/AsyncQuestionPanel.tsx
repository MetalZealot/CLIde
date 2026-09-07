import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PendingAsyncQuestion } from '../../utils/asyncQuestionState';
import { asyncQuestionDraftKey } from '../../utils/asyncQuestionState';
import { safeLocalStorage } from '../../utils/chatStorage';

type AsyncQuestionPanelProps = {
  sessionId: string;
  question: PendingAsyncQuestion;
  pendingCount: number;
  isProcessing: boolean;
  isSending: boolean;
  error: string | null;
  onSubmit: (answer: string, delivery: 'send' | 'queue') => boolean;
};

const OTHER_VALUE = '__other__';

export default function AsyncQuestionPanel({
  sessionId,
  question,
  pendingCount,
  isProcessing,
  isSending,
  error,
  onSubmit,
}: AsyncQuestionPanelProps) {
  const { t } = useTranslation('chat');
  const groupName = useId();
  const otherRadioId = useId();
  const otherInputId = useId();
  const [other, setOther] = useState(
    () => safeLocalStorage.getItem(asyncQuestionDraftKey(sessionId, question.id)) ?? '',
  );
  const [selection, setSelection] = useState(
    () => other ? OTHER_VALUE : question.options[0] ?? OTHER_VALUE,
  );

  useEffect(() => {
    const key = asyncQuestionDraftKey(sessionId, question.id);
    if (other.trim()) safeLocalStorage.setItem(key, other);
    else safeLocalStorage.removeItem(key);
  }, [other, question.id, sessionId]);

  const answer = selection === OTHER_VALUE ? other.trim() : selection;

  return (
    <section
      aria-labelledby={`${groupName}-title`}
      className="mx-auto mb-3 max-w-[54.25rem] rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('followUpQuestions.pending', { defaultValue: 'Question' })}
        </p>
        {pendingCount > 1 && (
          <span className="text-xs text-muted-foreground">
            {t('followUpQuestions.remaining', {
              count: pendingCount,
              defaultValue: '{{count}} remaining',
            })}
          </span>
        )}
      </div>

      <fieldset disabled={isSending} className="space-y-2.5">
        <legend id={`${groupName}-title`} className="mb-2 text-base font-medium leading-6 text-foreground">
          {question.question}
        </legend>

        {question.options.map((option) => (
          <label
            key={option}
            className="has-[:checked]:bg-primary/8 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring has-[:checked]:border-primary"
          >
            <input
              type="radio"
              name={groupName}
              value={option}
              checked={selection === option}
              onChange={() => setSelection(option)}
              className="h-4 w-4 accent-primary"
            />
            <span>{option}</span>
          </label>
        ))}

        <div
          className="has-[:checked]:bg-primary/8 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring has-[:checked]:border-primary"
        >
          <input
            id={otherRadioId}
            type="radio"
            name={groupName}
            value={OTHER_VALUE}
            checked={selection === OTHER_VALUE}
            onChange={() => setSelection(OTHER_VALUE)}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          <label htmlFor={otherRadioId} className="cursor-pointer">
            {t('followUpQuestions.other', { defaultValue: 'Other' })}
          </label>
          <input
            id={otherInputId}
            type="text"
            value={other}
            onFocus={() => setSelection(OTHER_VALUE)}
            onChange={(event) => setOther(event.target.value)}
            placeholder={t('followUpQuestions.otherPlaceholder', { defaultValue: 'Type an answer…' })}
            aria-label={t('followUpQuestions.otherAnswer', { defaultValue: 'Other answer' })}
            className="min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-muted-foreground"
          />
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={!answer || isSending}
          onClick={() => onSubmit(answer, 'queue')}
          className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('followUpQuestions.queue', { defaultValue: 'Queue' })}
        </button>
        <button
          type="button"
          disabled={!answer || isSending}
          onClick={() => onSubmit(answer, 'send')}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSending
            ? t('followUpQuestions.sending', { defaultValue: 'Sending…' })
            : isProcessing
              ? t('followUpQuestions.sendCurrent', { defaultValue: 'Send now' })
              : t('followUpQuestions.sendNext', { defaultValue: 'Send' })}
        </button>
      </div>
    </section>
  );
}
