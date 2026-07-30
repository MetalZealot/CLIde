import { cn } from '../../../../lib/utils';

export type SettingsStatusState = 'on' | 'off' | 'pending';

type SettingsStatusProps = {
  state: SettingsStatusState;
  /** Omitted in tight places (the desktop rail), where the dot alone reads. */
  label?: string;
  className?: string;
};

const DOT_CLASSES: Record<SettingsStatusState, string> = {
  on: 'bg-primary',
  off: 'bg-muted-foreground/40',
  pending: 'bg-muted-foreground/30 animate-pulse',
};

/**
 * A status dot with optional copy, for rows that report a connection state —
 * provider sign-in today.
 *
 * Build-plan decision 3 settled the copy: a dot plus "Signed in" / "Signed out",
 * not "Connected". The spec hedged on this because an idle-expired Claude OAuth
 * credential used to report as logged out; that was resolved in `1e13431`, so
 * the status now means what it says. `primary` rather than a green literal
 * follows P3a/P3c — no `--success` token exists and none is needed yet.
 */
export default function SettingsStatus({ state, label, className }: SettingsStatusProps) {
  return (
    <span className={cn('flex flex-shrink-0 items-center gap-2', className)}>
      <span className={cn('h-2 w-2 rounded-full', DOT_CLASSES[state])} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </span>
  );
}
