import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../types/types';
import { useHistoryDetail } from '../../hooks/useHistoryDetail';
import { useUiPreference } from '../../../../hooks/useUiPreferences';
import { buildOperationDetail, type DetailLine } from '../../utils/operationDetail';

import { DetailPanel } from './DetailPanel';
import { DISCLOSED_TEXT_CLASS } from './DisclosureRow';
import { Markdown } from './Markdown';

/** Lines each block shows before "Show all". */
export const DETAIL_LINE_CAP = 12;

const TONE_CLASS: Record<DetailLine['tone'], string> = {
  command: 'text-foreground',
  output: 'text-muted-foreground',
  error: 'text-red-600 dark:text-red-400',
  added: 'bg-green-500/10 text-green-800 dark:text-green-300',
  removed: 'bg-red-500/10 text-red-800 dark:text-red-300',
  gap: 'text-muted-foreground/60',
};

const SIGN: Partial<Record<DetailLine['tone'], string>> = { added: '+', removed: '−', gap: '⋯' };

const wrapClass = 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]';
const scrollClass = 'max-w-none whitespace-pre';

function DetailLineRow({ line, isFirstCommand, wrap }: { line: DetailLine; isFirstCommand: boolean; wrap: boolean }) {
  const sign = SIGN[line.tone];
  if (sign !== undefined) {
    return (
      // `max-w-none` lets the tint bleed past the chat's 100% max-width rule to the panel edge. Plain
      // block, not flex, so its first row can flow beside the floated buttons; the sign hangs in the padding.
      <div className={`-mx-2.5 max-w-none pl-6 pr-2.5 ${wrap ? wrapClass : scrollClass} ${TONE_CLASS[line.tone]}`}>
        <span className="-ml-3.5 inline-block w-3.5 select-none opacity-70" aria-hidden>{sign}</span>
        {line.text || ' '}
      </div>
    );
  }
  return (
    <div className={`${wrap ? wrapClass : scrollClass} ${TONE_CLASS[line.tone]}`}>
      {isFirstCommand && <span className="select-none text-muted-foreground/70">$ </span>}
      {line.text || ' '}
    </div>
  );
}

/** Unwrapped, a block scrolls sideways as one, every row as wide as its longest. */
function CodeBlockScroll({ wrap, children }: { wrap: boolean; children: ReactNode }) {
  if (wrap) return <>{children}</>;
  return (
    <div className="-mx-2.5 max-w-none overflow-x-auto px-2.5">
      <div className="w-max min-w-full max-w-none">{children}</div>
    </div>
  );
}

interface OperationDetailProps {
  message: ChatMessage;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  /** Leads the panel, above the call's lines. */
  heading?: ReactNode;
  /** Closes the panel, after "Show all" and "Open file". */
  footer?: ReactNode;
}

/** A call's full input and result, flat, under its line in an open activity. */
const OperationDetail = memo(function OperationDetail({ message, onFileOpen, heading, footer }: OperationDetailProps) {
  const { t } = useTranslation('chat');
  const history = useHistoryDetail(message, true);
  const detail = useMemo(() => buildOperationDetail(history.message), [history.message]);
  const [showAll, setShowAll] = useState(false);

  const cappedLines = detail.blocks.reduce(
    (hidden, block) => hidden + (block.type === 'lines' ? Math.max(0, block.lines.length - DETAIL_LINE_CAP)
      : block.type === 'files' ? Math.max(0, block.paths.length - DETAIL_LINE_CAP) : 0),
    0,
  );
  const totalLines = detail.blocks.reduce(
    (total, block) => total + (block.type === 'lines' ? block.lines.length : block.type === 'files' ? block.paths.length : 0),
    0,
  );
  const cap = <T,>(items: T[]): T[] => (showAll ? items : items.slice(0, DETAIL_LINE_CAP));
  const isProse = detail.blocks.length > 0 && detail.blocks.every((block) => block.type === 'prose');
  // The panel's toggle inverts the setting for this call only; it is never saved.
  const wrapSetting = useUiPreference('wrapToolOutput');
  const [wrapFlipped, setWrapFlipped] = useState(false);
  const hasCode = detail.blocks.some((block) => block.type !== 'prose');
  const wrap = !hasCode || wrapSetting !== wrapFlipped;

  return (
    <DetailPanel
      copyText={detail.copyText}
      wrap={hasCode ? { on: wrap, toggle: () => setWrapFlipped((flipped) => !flipped) } : undefined}
      className={isProse ? 'text-chat-activity' : 'font-mono text-xs leading-[18px]'}>
      {/* Wrapping text flows around the floated buttons; the overlay needs the heading kept clear. */}
      {heading && <div className={`mb-1.5 font-sans ${wrap ? '' : 'pr-14'}`}>{heading}</div>}
      {detail.blocks.map((block, index) => (
        <div key={index} className={index > 0 ? 'mt-1.5' : ''}>
          {block.type === 'prose' && <Markdown className={DISCLOSED_TEXT_CLASS}>{block.text}</Markdown>}
          {block.type === 'files' && (
            <CodeBlockScroll wrap={wrap}>
              {cap(block.paths).map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`block w-full text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline ${wrap ? wrapClass : scrollClass}`}
                  onClick={() => onFileOpen?.(path)}
                >
                  {path}
                </button>
              ))}
            </CodeBlockScroll>
          )}
          {block.type === 'lines' && (
            <>
              {block.heading && (
                <div className={`font-sans text-chat-meta text-muted-foreground ${index === 0 && !heading && !wrap ? 'pr-14' : ''}`}>{block.heading}</div>
              )}
              <CodeBlockScroll wrap={wrap}>
                {cap(block.lines).map((line, lineIndex) => (
                  <DetailLineRow
                    key={lineIndex}
                    line={line}
                    isFirstCommand={line.tone === 'command' && lineIndex === 0 && !block.heading}
                    wrap={wrap}
                  />
                ))}
              </CodeBlockScroll>
            </>
          )}
        </div>
      ))}

      {history.status === 'loading' && (
        <div className="mt-1.5 font-sans text-chat-meta text-muted-foreground" role="status">{t('tools.loadingDetail')}</div>
      )}
      {history.status === 'error' && (
        <div className="mt-1.5 flex gap-2 font-sans text-chat-meta text-red-600 dark:text-red-400" role="alert">
          {t('tools.detailFailed')}
          <button type="button" className="underline" onClick={history.request}>{t('tools.retryDetail')}</button>
        </div>
      )}

      {detail.blocks.length === 0 && history.status !== 'loading' && (
        <div className="font-sans text-chat-meta text-muted-foreground">{t('activity.detail.empty')}</div>
      )}

      {((cappedLines > 0 && !showAll) || (detail.openPath && onFileOpen)) && (
        <div className="mt-1.5 flex gap-4 font-sans text-chat-meta">
          {cappedLines > 0 && !showAll && (
            <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowAll(true)}>
              {t('activity.detail.showAll', { count: totalLines })}
            </button>
          )}
          {detail.openPath && onFileOpen && (
            <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => onFileOpen(detail.openPath as string)}>
              {t('activity.detail.openFile')}
            </button>
          )}
        </div>
      )}
      {footer}
    </DetailPanel>
  );
});

export default OperationDetail;
