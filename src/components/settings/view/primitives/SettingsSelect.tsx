import { cn } from '../../../../lib/utils';

export type SettingsSelectOption<T extends string> = {
  value: T;
  label: string;
};

type SettingsSelectProps<T extends string> = {
  value: T;
  options: SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
};

/** The one select in Settings. Saves immediately on change, per the save model. */
export default function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SettingsSelectProps<T>) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground',
        'focus:border-primary focus:ring-1 focus:ring-primary',
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
