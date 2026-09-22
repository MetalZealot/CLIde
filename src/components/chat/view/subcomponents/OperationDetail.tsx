import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../types/types';
import { useHistoryDetail } from '../../hooks/useHistoryDetail';
import { buildOperationDetail, type DetailLine } from '../../utils/operationDetail';

import { DetailPanel } from './DetailPanel';

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

// Wraps anywhere so no line ever scrolls sideways.
const wrapClass = 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]';

// The panel's first line leaves room for the copy button in its corner.
const CORNER = 'pr-6';

function DetailLineRow({ line, isFirstCommand, reserveCorner }: { line: DetailLine; isFirstCommand: boolean; reserveCorner: boolean }) {
  const sign = SIGN[line.tone];
  if (sign !== undefined) {
    return (
      // `max-w-none` lets the tint bleed past the chat's 100% max-width rule to the panel edge.
      <div className={`-mx-2.5 flex max-w-none pl-2.5 ${reserveCorner ? 'pr-8' : 'pr-2.5'} ${TONE_CLASS[line.tone]}`}>
        <span className="w-3.5 flex-shrink-0 select-none opacity-70" aria-hidden>{sign}</span>
        <span className={wrapClass}>{line.text || ' '}</span>
      </div>
    );
  }
  return (
    <div className={`${wrapClass} ${TONE_CLASS[line.tone]} ${reserveCorner ? CORNER : ''}`}>
      {isFirstCommand && <span className="select-none text-muted-foreground/70">$ </span>}
      {line.text || ' '}
    </div>
  );
}

interface OperationDetailProps {
  message: ChatMessage;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
}

/** A call's full input and result, flat, under its line in an open activity. */
const OperationDetail = memo(function OperationDetail({ message, onFileOpen }: OperationDetailProps) {
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

  return (
    <DetailPanel copyText={detail.copyText} className={isProse ? 'text-[13px] leading-5' : 'font-mono text-xs leading-[18px]'}>
      {detail.blocks.map((block, index) => (
        <div key={index} className={`${index > 0 ? 'mt-1.5' : ''} ${index === 0 && block.type !== 'lines' ? CORNER : ''}`}>
          {block.type === 'prose' && <div className={`${wrapClass} text-muted-foreground`}>{block.text}</div>}
          {block.type === 'files' && cap(block.paths).map((path) => (
            <button
              key={path}
              type="button"
              className={`block w-full text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline ${wrapClass}`}
              onClick={() => onFileOpen?.(path)}
            >
              {path}
            </button>
          ))}
          {block.type === 'lines' && (
            <>
              {block.heading && (
                <div className={`font-sans text-[11px] text-muted-foreground ${index === 0 ? CORNER : ''}`}>{block.heading}</div>
              )}
              {cap(block.lines).map((line, lineIndex) => (
                <DetailLineRow
                  key={lineIndex}
                  line={line}
                  isFirstCommand={line.tone === 'command' && lineIndex === 0 && !block.heading}
                  reserveCorner={index === 0 && lineIndex === 0 && !block.heading}
                />
              ))}
            </>
          )}
        </div>
      ))}

      {history.status === 'loading' && (
        <div className="mt-1.5 font-sans text-xs text-muted-foreground" role="status">{t('tools.loadingDetail')}</div>
      )}
      {history.status === 'error' && (
        <div className="mt-1.5 flex gap-2 font-sans text-xs text-red-600 dark:text-red-400" role="alert">
          {t('tools.detailFailed')}
          <button type="button" className="underline" onClick={history.request}>{t('tools.retryDetail')}</button>
        </div>
      )}

      {detail.blocks.length === 0 && history.status !== 'loading' && (
        <div className="font-sans text-xs text-muted-foreground">{t('activity.detail.empty')}</div>
      )}

      {((cappedLines > 0 && !showAll) || (detail.openPath && onFileOpen)) && (
        <div className="mt-1.5 flex gap-4 font-sans text-xs">
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
    </DetailPanel>
  );
});

export default OperationDetail;
