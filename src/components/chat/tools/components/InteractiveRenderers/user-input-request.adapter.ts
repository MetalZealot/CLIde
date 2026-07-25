import type { Provider, Question } from '../../../types/types';

export function adaptUserInputAnswers(
  provider: Provider | undefined,
  questions: Array<Pick<Question, 'id' | 'question'>>,
  answers: Record<string, string[]>,
): Record<string, string[] | string> {
  if (provider === 'codex') {
    return answers;
  }
  return Object.fromEntries(questions.flatMap((question) => {
    const values = answers[question.id || question.question];
    return values ? [[question.question, values.join(', ')]] : [];
  }));
}
