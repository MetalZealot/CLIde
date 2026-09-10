import { useTranslation } from 'react-i18next';
import { PlayIcon } from 'lucide-react';

import type { UsageLimitStop } from '../../../../stores/useSessionStore';
import { formatClockTimeWithDay } from '../../../../utils/formatTime';

interface AutoContinueOfferCardProps {
  stop: UsageLimitStop;
  onAccept: () => void;
}

/**
 * Sits in the same strip as the waiting card it becomes, so accepting reads as
 * the card changing state rather than a new thing appearing.
 */
export default function AutoContinueOfferCard({ stop, onAccept }: AutoContinueOfferCardProps) {
  const { t } = useTranslation('chat');

  return (
    <button
      type="button"
      onClick={onAccept}
      className="settings-content-enter mx-auto mb-2 flex w-full max-w-[54.25rem] items-center gap-2.5 rounded-xl border border-dashed border-primary/40 bg-primary/[0.06] px-3 py-2 text-left transition-colors hover:bg-primary/10 active:bg-primary/15"
    >
      <PlayIcon className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-primary/70">
          {t('input.autoContinue.title', { defaultValue: 'Auto-Continue' })}
        </div>
        <p className="mt-0.5 break-words text-sm text-foreground/90">
          {stop.resetsAt
            ? t('input.autoContinue.offerAt', {
              defaultValue: 'Send "Continue" when usage resets at {{time}}',
              time: formatClockTimeWithDay(stop.resetsAt),
            })
            : t('input.autoContinue.offer', {
              defaultValue: 'Send "Continue" when usage resets',
            })}
        </p>
      </div>
    </button>
  );
}
