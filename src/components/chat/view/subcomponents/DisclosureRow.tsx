import { memo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { Shimmer } from '../../../../shared/view/ui/Shimmer';

import { DetailPanel } from './DetailPanel';

// Muted markdown in a detail panel; the first block clears the copy button.
export const DISCLOSED_TEXT_CLASS = 'prose prose-sm max-w-none font-prose text-chat-activity text-muted-foreground dark:prose-invert prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-chat-activity prose-headings:font-semibold [&>*:first-child]:mt-0 [&>*:first-child]:pr-6';

/** One truncated line while closed; the whole label wraps once opened. */
export const rowLabelClass = (isOpen: boolean): string => (isOpen ? 'min-w-0 [overflow-wrap:anywhere]' : 'min-w-0 truncate');

interface DisclosureRowProps {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  isRunning?: boolean;
  /** Sits after the label, before the chevron. */
  trailing?: ReactNode;
}

/** One muted line with the chevron after its label — the activity row's shape. */
export function DisclosureRow({ label, isOpen, onToggle, isRunning = false, trailing }: DisclosureRowProps) {
  return (
    <button
      type="button"
      className="flex min-h-6 w-full items-center gap-1 text-left text-chat-activity text-muted-foreground transition-colors hover:text-foreground sm:min-h-7"
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      {isRunning ? (
        <Shimmer className={`${rowLabelClass(isOpen)} motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground`}>
          {label}
        </Shimmer>
      ) : (
        <span className={rowLabelClass(isOpen)}>{label}</span>
      )}
      {trailing}
      <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
    </button>
  );
}

/** The activity row's shape with nothing to open: no chevron, not a button. */
export function StaticRow({ label }: { label: string }) {
  return (
    <p className="flex min-h-6 items-center text-chat-activity text-muted-foreground sm:min-h-7">
      <span className="min-w-0 truncate">{label}</span>
    </p>
  );
}

interface TextDisclosureProps {
  label: string;
  copyText: string;
  className?: string;
  children: ReactNode;
}

/** A closed row over text the model wrote for itself; the text mounts only once opened. */
export const TextDisclosure = memo(function TextDisclosure({ label, copyText, className = '', children }: TextDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={className}>
      <DisclosureRow label={label} isOpen={isOpen} onToggle={() => setIsOpen((current) => !current)} />
      {isOpen && <DetailPanel copyText={copyText}>{children}</DetailPanel>}
    </div>
  );
});
