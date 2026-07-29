import type { ReactNode } from 'react';

import { cn } from '../../../../lib/utils';

export type SettingsTone = 'default' | 'warning' | 'danger';

type SettingsGroupProps = {
  /** Omit for an unlabelled card, e.g. a single lead card at the top of a screen. */
  title?: string;
  description?: string;
  children: ReactNode;
  /** Separates stacked rows with hairlines. */
  divided?: boolean;
  /**
   * Maps to theme tokens, never to literal colour classes. This is what lets
   * Notifications, Permissions, Account and Tasks share one visual language
   * without redesigning each of them.
   */
  tone?: SettingsTone;
  className?: string;
};

const TONE_CLASSES: Record<SettingsTone, string> = {
  default: 'border-border bg-card/50',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-destructive/40 bg-destructive/10',
};

export default function SettingsGroup({
  title,
  description,
  children,
  divided,
  tone = 'default',
  className,
}: SettingsGroupProps) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || description) && (
        <div>
          {title && (
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </h3>
          )}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}

      <div
        className={cn(
          'overflow-hidden rounded-xl border',
          TONE_CLASSES[tone],
          divided && 'divide-y divide-border',
        )}
      >
        {children}
      </div>
    </section>
  );
}
