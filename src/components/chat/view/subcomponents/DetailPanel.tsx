import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, WrapText } from 'lucide-react';

import { copyTextToClipboard } from '../../../../utils/clipboard';

interface DetailPanelProps {
  /** What the corner button copies; no button when empty. */
  copyText?: string;
  /** Shows the wrap toggle beside copy, pressed while lines wrap. */
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

  return (
    <div className={`relative mb-1.5 mt-0.5 rounded-md bg-muted/60 px-2.5 py-2 dark:bg-muted/40 ${className}`}>
      {(copyText || wrap) && (
        // Opaque, panel-coloured backing so sideways-scrolled lines pass under the buttons.
        <div className="absolute right-1 top-1 z-10 rounded bg-background">
          <div className="flex rounded bg-muted/60 dark:bg-muted/40">
            {wrap && (
              <button
                type="button"
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:text-foreground ${wrap.on ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground/70'}`}
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
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                onClick={copy}
                aria-label={copied ? t('activity.detail.copied') : t('activity.detail.copy')}
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
});
