import type { ReactNode } from 'react';

import { cn } from '../../../../lib/utils';

type SettingsScreenProps = {
  description?: string;
  children: ReactNode;
  className?: string;
};

/**
 * The outermost element of every settings screen, and **the only scroll
 * container on it**.
 *
 * Nothing rendered inside a screen may open its own `overflow-y-auto`. Nested
 * scrollers are what caused the Agents pane's scrolling bugs and its clipped
 * Connection Status panel: an inner container derived its height from a flex
 * chain that did not account for the modal's safe-area padding. One scroller
 * per screen makes that structurally impossible.
 */
export default function SettingsScreen({ description, children, className }: SettingsScreenProps) {
  return (
    <div className={cn('min-w-0 flex-1 overflow-y-auto overflow-x-hidden', className)}>
      <div className="min-w-0 space-y-6 p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6">
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}
