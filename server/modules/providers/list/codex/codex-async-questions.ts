import type { FollowUpQuestion } from '@/shared/types.js';

/** Validates Codex's untrusted async-question metadata at the adapter boundary. */
export function normalizeCodexAsyncQuestions(value: unknown): FollowUpQuestion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const questions: FollowUpQuestion[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    if (typeof record.title !== 'string' || !record.title.trim()) {
      continue;
    }

    const options = Array.isArray(record.options)
      ? record.options
          .filter((option): option is string => typeof option === 'string' && Boolean(option.trim()))
          .map((option) => option.trim())
      : [];

    questions.push({
      question: record.title.trim(),
      options,
    });
  }

  return questions.length > 0 ? questions : undefined;
}
