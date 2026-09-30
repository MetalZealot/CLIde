import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, WrapText } from 'lucide-react';

import { copyTextToClipboard } from '../../../../utils/clipboard';

// Solid and bordered, so a button reads the same over the panel, a tinted diff row, or scrolled text.
const BUTTON = 'flex h-6 w-6 items-center justify-center rounded-md border border-border/70 transition-colors hover:text-foreground';

interface DetailPanelProps {
  /** What the corner button copies; no button when empty. */
  copyText?: string;
  /** Shows the wrap toggle beside copy, pressed while lines wrap. Unwrapped lines scroll under the buttons. */
  wrap?: { on: boolean; toggle: () => void };
  className?: string;
  children: ReactNode;
}

/** The flat panel a row opens to: no border, header or strip. */
export const DetailPanel = memo(function DetailPanel({ copyText, wrap, className = '', children }: DetailPanelProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (copyText && await copyTextToClipboard(copyText)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const buttons = (
    <>
      {wrap && (
        <button
          type="button"
          className={`${BUTTON} ${wrap.on ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground'}`}
          onClick={wrap.toggle}
          aria-label={t('activity.detail.wrap')}
          aria-pressed={wrap.on}
        >
          <WrapText className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {copyText && (
        <button
          type="button"
          className={`${BUTTON} bg-background text-muted-foreground`}
          onClick={copy}
          aria-label={copied ? t('activity.detail.copied') : t('activity.detail.copy')}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
      )}
    </>
  );

  return (
    <div className={`relative mb-1.5 mt-0.5 flow-root rounded-md bg-muted/60 px-2.5 py-2 dark:bg-muted/40 ${className}`}>
      {(copyText || wrap) && (wrap?.on === false ? (
        // Unwrapped lines can't flow around the corner, so they slide under the buttons.
        <div className="absolute right-1 top-1 z-10 flex gap-1">{buttons}</div>
      ) : (
        // Floated so only the rows beside the buttons wrap short; -mb-1 keeps the float off the second row.
        <div className="float-right -mb-1 -mr-1.5 -mt-1 ml-2 flex gap-1">{buttons}</div>
      ))}
      {children}
    </div>
  );
});
