import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type ComposerNoticeProps = {
  children: ReactNode;
  /** Sits before the message, e.g. a spinner. */
  leading?: ReactNode;
  /** Buttons between the message and the dismiss control. */
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
};

/** Neutral notice above the composer: the input's width, the queue row's height and radius. */
export default function ComposerNotice({ children, leading, actions, onDismiss, dismissLabel }: ComposerNoticeProps) {
  return (
    <div className="mx-auto mb-2 max-w-[54.25rem]">
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 py-1 pl-3 pr-1 text-xs leading-4 text-muted-foreground">
        {leading}
        {/* py-2 makes a one-line message as tall as the 32px buttons beside it. */}
        <span role="status" className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">{children}</span>
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            title={dismissLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** Text action inside a ComposerNotice, sized to its dismiss control. */
export const composerNoticeActionClass = 'h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
