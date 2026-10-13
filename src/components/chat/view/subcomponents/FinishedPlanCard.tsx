import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedProgress } from '../../../../shared/view/ui';
import type { SessionPlan } from '../../../../stores/useSessionStore';

import { PlanStepList } from './PlanBanner';

/** A finished plan, kept in the chat at the end of the turn it finished in; the banner's finished state, closed. */
export default function FinishedPlanCard({ plan }: { plan: SessionPlan }) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const total = plan.steps.length;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {/* The bar sits under the header row, so opening the card pushes the steps below it. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex min-h-10 w-full select-none items-center gap-2 px-3 text-left text-chat-activity text-muted-foreground transition-colors hover:text-foreground"
        >
          <Check className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />
          <span className="shrink-0 font-semibold">{t('planBanner.label')}</span>
          <span className="shrink-0 tabular-nums">{total}/{total}</span>
          <span className="min-w-0 flex-1 truncate">{t('planBanner.allDone')}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <SegmentedProgress done={total} total={total} doneClassName="bg-green-500/50" className="absolute inset-x-0 bottom-0 h-[3px]" />
      </div>
      {isOpen && <PlanStepList steps={plan.steps} className="px-3 pb-2 pt-1 text-chat-activity" />}
    </div>
  );
}
