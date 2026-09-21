import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type QuestionPanelFrameProps = {
  waitingLabel: string;
  heading: ReactNode;
  children: ReactNode;
  actions: ReactNode;
};

export default function QuestionPanelFrame({ waitingLabel, heading, children, actions }: QuestionPanelFrameProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const contentId = useId();

  return (
    <div className="relative flex max-h-[calc((100dvh-var(--keyboard-height,0px))*0.5)] min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-controls={contentId}
        aria-label={isCollapsed ? undefined : 'Collapse question'}
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        onKeyDown={(event) => event.stopPropagation()}
        className={isCollapsed
          ? 'flex min-h-11 w-full shrink-0 touch-manipulation items-center justify-between gap-3 px-4 text-left text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:hidden'
          : 'absolute right-0 top-0 z-10 flex h-11 w-11 touch-manipulation items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:hidden'}
      >
        {isCollapsed ? (
          <>
            <span aria-live="polite" className="truncate text-xs font-medium text-foreground">{waitingLabel}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs">
              Show question
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </span>
          </>
        ) : <ChevronUp className="h-5 w-5" aria-hidden="true" />}
      </button>
      <div id={contentId} className={`${isCollapsed ? 'hidden sm:flex' : 'flex'} min-h-0 flex-col`}>
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border py-2 pl-4 pr-12 sm:pr-4">
          {heading}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">
          {children}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2">
          {actions}
        </div>
      </div>
    </div>
  );
}
