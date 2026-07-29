import { cn } from '../../../../lib/utils';

type SettingsTextFieldProps = {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'email';
  placeholder?: string;
  autoComplete?: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  /** For fields that save on blur rather than immediately, e.g. Git identity. */
  onBlur?: () => void;
};

/**
 * The one free-text input in Settings. Saves immediately on change by default,
 * matching `SettingsSelect` — pass `onBlur` for the fields that opt into
 * save-on-blur instead (git identity; see the save model in the IA spec).
 */
export default function SettingsTextField({
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  ariaLabel,
  className,
  disabled,
  onBlur,
}: SettingsTextFieldProps) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className={cn(
        'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground placeholder:text-muted-foreground',
        'focus:border-primary focus:ring-1 focus:ring-primary',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    />
  );
}
