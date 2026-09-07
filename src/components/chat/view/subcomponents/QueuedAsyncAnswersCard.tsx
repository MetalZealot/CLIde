import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { QueuedAsyncAnswer } from '../../utils/asyncQuestionState';

type QueuedAsyncAnswersCardProps = {
  answers: QueuedAsyncAnswer[];
  onRemove: (answerId: string) => void;
};

export default function QueuedAsyncAnswersCard({ answers, onRemove }: QueuedAsyncAnswersCardProps) {
  const { t } = useTranslation('chat');
  if (answers.length === 0) return null;

  return (
    <section
      aria-label={t('followUpQuestions.queuedTitle', { defaultValue: 'Queued answers' })}
      className="mx-auto mb-3 max-w-[54.25rem] space-y-2 rounded-xl border border-border/60 bg-muted/40 p-3"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {answers.length === 1
          ? t('followUpQuestions.queuedOne', { defaultValue: '1 answer queued for the next turn' })
          : t('followUpQuestions.queuedMany', {
              count: answers.length,
              defaultValue: '{{count}} answers queued for later turns',
            })}
      </p>
      {answers.map((answer) => (
        <div key={answer.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">
            <span className="font-medium">{answer.question}</span>
            <span className="text-muted-foreground"> — {answer.answer}</span>
          </p>
          <button
            type="button"
            onClick={() => onRemove(answer.id)}
            aria-label={t('followUpQuestions.removeQueued', {
              defaultValue: 'Remove queued answer to {{question}}',
              question: answer.question,
            })}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </section>
  );
}
