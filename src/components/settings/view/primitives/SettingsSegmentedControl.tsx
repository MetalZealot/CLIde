import { cn } from '../../../../lib/utils';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type SettingsSegmentedControlProps<T extends string> = {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
};

/**
 * A small exclusive choice rendered inline — used for Theme (Light / Dark /
 * System), where a dropdown would hide two of three options behind a tap and a
 * toggle cannot express three states at all.
 */
export default function SettingsSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
}: SettingsSegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex rounded-lg border border-input bg-muted/50 p-0.5',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 touch-manipulation rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
