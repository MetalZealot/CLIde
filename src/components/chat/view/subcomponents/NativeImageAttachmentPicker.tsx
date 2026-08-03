import type { InputHTMLAttributes } from 'react';
import { PaperclipIcon } from 'lucide-react';

import { buttonVariants, Tooltip } from '../../../../shared/view/ui';

type NativeImageAttachmentPickerProps = {
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  label: string;
};

/**
 * Lets the file input itself own the user's tap.
 *
 * Android standalone PWAs can lose the result of a picker opened through a
 * JavaScript-generated `input.click()`. Keeping the real input stretched over
 * the visible control gives Android a direct native activation while
 * react-dropzone still owns change handling, validation, and drag/drop.
 *
 * Accepted types come from the dropzone config, not from here — since v1.37
 * that is any file, not just images, so the control wears a paperclip.
 */
export default function NativeImageAttachmentPicker({
  getInputProps,
  label,
}: NativeImageAttachmentPickerProps) {
  const inputProps = getInputProps({
    'aria-label': label,
    className: 'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0',
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      cursor: 'pointer',
    },
    tabIndex: 0,
  }) as InputHTMLAttributes<HTMLInputElement>;

  return (
    <Tooltip content={label} position="top">
      <span
        className={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          className: 'relative h-8 w-8 focus-within:ring-1 focus-within:ring-ring [&_svg]:size-4',
        })}
      >
        <PaperclipIcon aria-hidden="true" />
        <input {...inputProps} />
      </span>
    </Tooltip>
  );
}
