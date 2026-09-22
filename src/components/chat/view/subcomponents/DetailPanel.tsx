import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

import { copyTextToClipboard } from '../../../../utils/clipboard';

interface DetailPanelProps {
  /** What the corner button copies; no button when empty. */
  copyText?: string;
  className?: string;
  children: ReactNode;
}

/** The flat panel a row opens to: no border, header or strip. */
export const DetailPanel = memo(function DetailPanel({ copyText, className = '', children }: DetailPanelProps) {
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
      {copyText && (
        <button
          type="button"
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={copy}
          aria-label={copied ? t('activity.detail.copied') : t('activity.detail.copy')}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
      )}
      {children}
    </div>
  );
});
