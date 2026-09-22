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
} from '../../utils/toolActivity';
import { formatDuration } from '../../utils/chatFormatting';
import { Shimmer } from '../../../../shared/view/ui/Shimmer';

import { DisclosureRow } from './DisclosureRow';
import OperationDetail from './OperationDetail';

interface ToolActivityProps {
  activity: ToolActivityItem;
  /** The newest activity of a run still in flight: it may name a running call. */
  isLive?: boolean;
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
}

const firstLine = (text: unknown): string =>
  String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) || '';

/** An operation line inside an open activity or agent. */
export const operationRowClass = 'flex min-h-6 w-full min-w-0 items-center gap-2 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:text-foreground sm:min-h-7 sm:text-sm';
const shimmerClass = 'min-w-0 flex-1 truncate motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground';

interface OperationRowProps {
  message: ChatMessage;
  isOpen: boolean;
  isLive: boolean;
  onToggle: (key: string) => void;
  messageKey: string;
}

/** One truncated line per call; its detail opens below it. */
export const OperationRow = memo(function OperationRow({ message, isOpen, isLive, onToggle, messageKey }: OperationRowProps) {
  const { t } = useTranslation('chat');

  if (message.isThinking) {
    return (
      <button type="button" className={operationRowClass} onClick={() => onToggle(messageKey)} aria-expanded={isOpen}>
        <span className="min-w-0 flex-1 truncate italic">{t('activity.thought', { text: firstLine(message.content) })}</span>
      </button>
    );
  }

  const operation = describeOperation(message);
  const label = operationLabel(operation, t, true);
  const isRunning = isLive && operation.status === 'running';
  const hasCounts = operation.kind === 'edit' && (operation.added > 0 || operation.removed > 0);
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
  isLive = false,
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
  const { label, isRunning } = describeActivity(summary, t, isLive);

  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={activity.timestamp || undefined}>
      <DisclosureRow
        label={label}
        isRunning={isRunning}
        isOpen={isExpanded}
        onToggle={() => setIsExpanded((current) => !current)}
        trailing={summary.failed > 0 && (
          <span className="flex-shrink-0 text-red-600 dark:text-red-400">
            · {t('activity.failed', { count: summary.failed })}
          </span>
        )}
      />

      {isExpanded && (
        <div className="ml-1 mt-0.5 border-l border-border pl-3">
          {activity.messages.map((message) => {
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
