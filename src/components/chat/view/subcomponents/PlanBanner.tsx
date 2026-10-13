import { Check, ChevronDown, Circle, ListChecks, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useHeaderBannerSlot } from '../../../../contexts/HeaderMenuContext';
import { PageScrollLock, SegmentedProgress, useCloseOnBack } from '../../../../shared/view/ui';
import { useSheetDrag } from '../../../../shared/view/ui/useSheetDrag';
import type { SessionPlan, SessionPlanStep } from '../../../../stores/useSessionStore';
import { isSamePlan } from '../../hooks/useSessionPlan';

type PlanBannerProps = {
  plan: SessionPlan | null;
  /** The last plan the chat shows as finished; the banner leaves once that is this plan. */
  finishedInChat?: SessionPlan | null;
  isVisible: boolean;
};

function StepIcon({ status }: { status: SessionPlanStep['status'] }) {
  if (status === 'completed') return <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />;
  if (status === 'in_progress') {
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />;
}

/** A plan's steps, ticked, running or waiting; shared by the banner's sheet and the finished-plan card. */
export function PlanStepList({ steps, className = '' }: { steps: SessionPlanStep[]; className?: string }) {
  return (
    <ol className={className}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2.5 py-1.5">
          <StepIcon status={step.status} />
          <span className={step.status === 'completed' ? 'text-muted-foreground line-through decoration-muted-foreground/50' : step.status === 'in_progress' ? 'font-semibold' : ''}>
            {step.subject}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The agent's checklist as one bar under the header; it opens a sheet over the chat, shaped like the header sheet. */
/** A finished plan moves into the chat as a card; one the chat cannot show stays here, muted, until replaced. */
export default function PlanBanner({ plan, finishedInChat = null, isVisible }: PlanBannerProps) {
  const { t } = useTranslation('chat');
  const slot = useHeaderBannerSlot();
  const [isOpen, setIsOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setIsOpen(false), []);
  const steps = plan?.steps ?? [];
  const done = steps.filter((step) => step.status === 'completed').length;
  const isFinished = done === steps.length;
  const isShown = isVisible && steps.length > 0 && !(isFinished && isSamePlan(plan, finishedInChat));

  useEffect(() => {
    if (!isShown) setIsOpen(false);
  }, [isShown]);

  useCloseOnBack(isOpen, close);
  useSheetDrag(sheetRef, scrimRef, isOpen, close, 'top');

  if (!slot || !isShown) return null;

  const running = steps.find((step) => step.status === 'in_progress');
  const next = steps.find((step) => step.status === 'pending');
  // The "-ing" label only once a step has started; a waiting step shows its name.
  const currentLabel = running ? running.activeForm || running.subject : next?.subject ?? t('planBanner.allDone');

  return createPortal(
    <>
      {isOpen && (
        <>
          <PageScrollLock />
          {/* Dims everything but the bar; a tap anywhere closes it. */}
          <div ref={scrimRef} className="fixed inset-0 z-[-1] touch-none bg-black/50" onClick={close} aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="relative flex h-10 w-full select-none items-center gap-2 border-b border-border/60 bg-background px-3 text-sm sm:px-4"
      >
        {isFinished
          ? <Check className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />
          : <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className={`shrink-0 font-semibold ${isFinished ? 'text-muted-foreground' : ''}`}>{t('planBanner.label')}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{done}/{steps.length}</span>
        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{currentLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        <SegmentedProgress
          done={done}
          total={steps.length}
          active={steps.filter((step) => step.status === 'in_progress').length}
          doneClassName={isFinished ? 'bg-green-500/50' : 'bg-primary'}
          className="absolute inset-x-0 -bottom-px h-[3px]"
        />
      </button>
      {isOpen && (
        // Clipped at the bar's bottom edge, so a drag up slides the sheet behind it.
        <div className="pointer-events-none absolute inset-x-0 top-full h-[60dvh] overflow-hidden">
          <div
            ref={sheetRef}
            className="pointer-events-auto mx-auto flex max-h-full w-full max-w-2xl animate-sheet-down flex-col overflow-hidden rounded-b-3xl border border-t-0 border-border/80 bg-popover shadow-2xl"
          >
            <PlanStepList steps={steps} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-1 text-sm sm:px-5" />
            <div className="flex shrink-0 justify-center pb-2.5 pt-1.5" aria-hidden="true">
              <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
            </div>
          </div>
        </div>
      )}
    </>,
    slot,
  );
}
