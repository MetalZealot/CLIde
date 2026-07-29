import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  /**
   * Puts the control on its own line beneath the label. For wide controls — a
   * segmented control, a long select — which otherwise squeeze the description
   * into a narrow column on a phone.
   */
  stacked?: boolean;
  className?: string;
};

export default function SettingsRow({
  label,
  description,
  children,
  stacked,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'gap-4 px-4 py-4',
        stacked ? 'flex flex-col' : 'flex items-center justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className={stacked ? 'w-full' : 'flex-shrink-0'}>{children}</div>
    </div>
  );
}
