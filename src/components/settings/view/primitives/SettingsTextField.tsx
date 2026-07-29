import { cn } from '../../../../lib/utils';

type SettingsTextFieldProps = {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  autoComplete?: string;
  ariaLabel: string;
  className?: string;
};

/** The one free-text input in Settings. Saves immediately on change, matching `SettingsSelect`. */
export default function SettingsTextField({
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  ariaLabel,
  className,
}: SettingsTextFieldProps) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground placeholder:text-muted-foreground',
        'focus:border-primary focus:ring-1 focus:ring-primary',
        className,
      )}
    />
  );
}
