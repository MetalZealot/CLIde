import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Warns when a session is opened close to the point where its context runs out.
 *
 * Claude Code shows the same thing in its status line ("Context is n% full —
 * Autocompact will trigger soon, which discards older messages"), and the
 * distinction it draws matters: with auto-compact ON the conversation gets
 * summarised out from under you, and with it OFF the session simply hits the
 * wall. Both are worth knowing BEFORE typing into a session resumed from
 * history, which is exactly when neither is visible.
 *
 * Deliberately fires once per session open rather than tracking usage live: it
 * is a "look before you start" notice, not a running alarm.
 */

/** Fraction of the usable ceiling that counts as "nearly out". */
const WARN_AT = 0.8;

const readNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type CompactionWarningBannerProps = {
  tokenBudget: Record<string, unknown> | null;
  sessionId: string | null;
  provider?: string;
  /** Opens the ring popover at the provider's available context detail. */
  onShowContext?: () => void;
};

export default function CompactionWarningBanner({
  tokenBudget,
  sessionId,
  provider,
  onShowContext,
}: CompactionWarningBannerProps) {
  const [visible, setVisible] = useState(false);
  // Latches so a session that keeps growing past the line does not re-warn on
  // every frame — one notice per time the session is opened.
  const armedForSession = useRef<string | null>(null);

  const used = readNumber(tokenBudget?.used);
  const contextWindow = readNumber(tokenBudget?.total);
  const threshold = readNumber(tokenBudget?.autoCompactThreshold);
  const compactsAutomatically = tokenBudget?.isAutoCompactEnabled === true && threshold > 0;
  const ceiling = compactsAutomatically ? threshold : contextWindow;
  const fraction = ceiling > 0 ? used / ceiling : 0;

  useEffect(() => {
    if (armedForSession.current !== sessionId) {
      armedForSession.current = sessionId;
      setVisible(false);
    }
  }, [sessionId]);

  useEffect(() => {
    // Usage arrives after the session loads, so the check runs when it lands —
    // but only while this session is still the one that armed the banner.
    if (armedForSession.current === sessionId && fraction >= WARN_AT) {
      setVisible(true);
      armedForSession.current = `${sessionId}:warned`;
    }
  }, [fraction, sessionId]);

  if (!visible || ceiling <= 0) {
    return null;
  }

  const percentFull = Math.round(fraction * 100);

  return (
    <div className="mx-2 mb-2 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm sm:mx-0">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          Context is {percentFull}% full
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {compactsAutomatically
            ? `Auto-compact fires at ${threshold.toLocaleString()} tokens and discards older messages, replacing them with a summary.`
            : tokenBudget?.isAutoCompactEnabled === false
              ? `Auto-compact is off for this session, so it will hit the ${contextWindow.toLocaleString()}-token limit rather than being summarised.`
              : provider === 'codex'
                ? 'Codex auto-compacts before its context limit; the runtime does not report the exact threshold here.'
                : 'Auto-compact status is not reported for this session.'}
          {onShowContext && (
            <>
              {' '}
              <button
                type="button"
                onClick={onShowContext}
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              >
                {provider === 'claude' ? 'See what is filling it' : 'View usage'}
              </button>
              .
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss context warning"
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
