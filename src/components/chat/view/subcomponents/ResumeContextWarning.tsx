import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon, XIcon } from 'lucide-react';

// Cost-based, not window-based: even a 25k-token resume is a real usage hit,
// long before the model's context window is anywhere near full.
const RESUME_CONTEXT_WARNING_THRESHOLD = 25_000;

type ResumeContextWarningProps = {
  tokenBudget: Record<string, unknown> | null;
  isProcessing: boolean;
  sessionKey: string | null;
};

/**
 * Warns before the first message into a resumed session: the whole
 * conversation history gets re-processed as input tokens, so sending into a
 * large transcript is expensive. Keys off the tokenBudget seeded from
 * fetchHistory's tokenUsage, so it works for any provider that reports it and
 * stays hidden for the rest.
 */
export default function ResumeContextWarning({
  tokenBudget,
  isProcessing,
  sessionKey,
}: ResumeContextWarningProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [sessionKey]);

  // Once a turn starts, the cost is already paid — keep the banner hidden for
  // the rest of the visit instead of nagging again after every response.
  useEffect(() => {
    if (isProcessing) {
      setDismissed(true);
    }
  }, [isProcessing]);

  const used = Number(tokenBudget?.used) || 0;
  if (dismissed || isProcessing || used < RESUME_CONTEXT_WARNING_THRESHOLD) {
    return null;
  }

  const formattedTokens = `${Math.round(used / 1000)}k`;

  return (
    <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {t('chat.resumeContextWarning', {
          defaultValue:
            'This conversation carries ~{{tokens}} tokens of context — your next message will re-process all of it. Consider a new session for unrelated work.',
          tokens: formattedTokens,
        })}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('chat.dismissResumeContextWarning', {
          defaultValue: 'Dismiss context size warning',
        })}
        className="-m-1 flex-shrink-0 rounded p-1 transition-colors hover:bg-amber-500/20"
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
