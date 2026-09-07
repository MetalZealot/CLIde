import { useTranslation } from 'react-i18next';

import type { FollowUpQuestion } from '../../types/types';

type FollowUpQuestionsProps = {
  questions: FollowUpQuestion[];
};

export default function FollowUpQuestions({ questions }: FollowUpQuestionsProps) {
  const { t } = useTranslation('chat');

  if (questions.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t('followUpQuestions.title', { defaultValue: 'Questions' })}
      className="mt-3 space-y-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      {questions.map(({ question, options }, questionIndex) => (
        <div key={`${question}-${questionIndex}`} className="space-y-2">
          <p className="font-medium text-foreground">{question}</p>
          {options.length > 0 && (
            <ul className="space-y-1.5">
              {options.map((option, optionIndex) => (
                <li
                  key={`${option}-${optionIndex}`}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {option}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {t('followUpQuestions.transcriptRecord', { defaultValue: 'Asked while the response continued.' })}
      </p>
    </section>
  );
}
