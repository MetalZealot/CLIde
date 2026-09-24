import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../types/types';
import type { ToolActivityItem } from '../../utils/toolGrouping';
import {
  describeActivity,
  describeOperation,
  formatLineCounts,
  operationLabel,
  summarizeActivity,
  thinkingDurationMs,
  waitingLabel,
} from '../../utils/toolActivity';
import { formatDuration } from '../../utils/chatFormatting';
import { Shimmer } from '../../../../shared/view/ui/Shimmer';

import { DisclosureRow, StaticRow } from './DisclosureRow';
import OperationDetail from './OperationDetail';

interface ToolActivityProps {
  activity: ToolActivityItem;
  /** The row above the activity, which times a thought that opens it. */
  previous?: ChatMessage | null;
  /** The newest activity of a run still in flight: it may name a running call. */
  isLive?: boolean;
  /** Its one call is waiting on a permission prompt. */
  isWaiting?: boolean;
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
}

const firstLine = (text: unknown): string =>
  String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) || '';
/** A thought's first line without its Markdown heading and emphasis marks. */
const plainFirstLine = (text: unknown): string => firstLine(text).replace(/^#+\s*/, '').replace(/\*\*|__/g, '');

/** An operation line inside an open activity or agent. */
export const operationRowClass = 'flex min-h-6 w-full min-w-0 items-center gap-2 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:text-foreground sm:min-h-7 sm:text-sm';
const shimmerClass = 'min-w-0 flex-1 truncate motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground';

interface OperationRowProps {
  message: ChatMessage;
  isOpen: boolean;
  isLive: boolean;
  onToggle: (key: string) => void;
  messageKey: string;
  /** The row before it, which times a thinking row. */
  previous?: ChatMessage;
}

/** One truncated line per call; its detail opens below it. */
export const OperationRow = memo(function OperationRow({ message, isOpen, isLive, onToggle, messageKey, previous }: OperationRowProps) {
  const { t } = useTranslation('chat');

  if (message.isThinking && !firstLine(message.content)) {
    const thinkingMs = thinkingDurationMs(previous, message);
    return (
      <StaticRow
        label={thinkingMs !== null && thinkingMs >= 1000
          ? t('activity.thoughtFor', { duration: formatDuration(thinkingMs) })
          : t('activity.thoughtUntimed')}
      />
    );
  }

  if (message.isThinking) {
    return (
      <button type="button" className={operationRowClass} onClick={() => onToggle(messageKey)} aria-expanded={isOpen}>
        <span className="min-w-0 flex-1 truncate italic">{t('activity.thought', { text: plainFirstLine(message.content) })}</span>
      </button>
    );
  }

  const operation = describeOperation(message);
  const isDenied = operation.status === 'denied';
  // A denied call never ran: name what it asked for, without its line counts.
  const label = isDenied ? waitingLabel(operation, t) : operationLabel(operation, t, true);
  const isRunning = isLive && operation.status === 'running';
  const hasCounts = !isDenied && operation.kind === 'edit' && (operation.added > 0 || operation.removed > 0);
  const failure = operation.status === 'error' || operation.status === 'denied' ? operation.status : null;

  return (
    <button type="button" className={operationRowClass} onClick={() => onToggle(messageKey)} aria-expanded={isOpen}>
      {isRunning ? <Shimmer className={shimmerClass}>{label}</Shimmer> : <span className="min-w-0 flex-1 truncate">{label}</span>}
      {hasCounts && <span className="flex-shrink-0 tabular-nums">{formatLineCounts(operation.added, operation.removed)}</span>}
      {failure && <span className="flex-shrink-0 text-red-600 dark:text-red-400">{t(`activity.status.${failure}`)}</span>}
      {operation.durationMs !== null && operation.durationMs >= 1000 && (
        <span className="flex-shrink-0 tabular-nums">{formatDuration(operation.durationMs)}</span>
      )}
    </button>
  );
});

const ToolActivity = memo(function ToolActivity({
  activity,
  previous,
  isLive = false,
  isWaiting = false,
  getMessageKey,
  onFileOpen,
}: ToolActivityProps) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOperation = useCallback((key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const summary = useMemo(() => summarizeActivity(activity.messages), [activity.messages]);
  const described = describeActivity(summary, t, isLive);
  const waitingFor = isWaiting ? summary.operations[0] : undefined;
  const deniedOnly = !waitingFor && summary.operations.length === 1 && summary.operations[0].status === 'denied'
    ? summary.operations[0]
    : undefined;
  const asked = waitingFor || deniedOnly;
  const label = asked ? waitingLabel(asked, t) : described.label;
  const isRunning = !waitingFor && described.isRunning;

  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={activity.timestamp || undefined}>
      <DisclosureRow
        label={label}
        isRunning={isRunning}
        isOpen={isExpanded}
        onToggle={() => setIsExpanded((current) => !current)}
        trailing={waitingFor ? (
          <span className="flex-shrink-0">· {t('activity.waitingForApproval')}</span>
        ) : summary.failed > 0 && (
          <span className="flex-shrink-0 text-red-600 dark:text-red-400">
            · {deniedOnly ? t('activity.status.denied') : t('activity.failed', { count: summary.failed })}
          </span>
        )}
      />

      {isExpanded && (
        <div className="ml-1 mt-0.5 border-l border-border pl-3">
          {activity.messages.map((message, index) => {
            const messageKey = getMessageKey(message);
            const isOpen = openKeys.has(messageKey);
            return (
              <div key={messageKey}>
                <OperationRow
                  message={message}
                  messageKey={messageKey}
                  isOpen={isOpen}
                  isLive={isLive}
                  onToggle={toggleOperation}
                  previous={index > 0 ? activity.messages[index - 1] : previous ?? undefined}
                />
                {isOpen && <OperationDetail message={message} onFileOpen={onFileOpen} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ToolActivity;
