import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolActivityItem } from '../../utils/toolGrouping';
import { describeActivity, summarizeActivity } from '../../utils/toolActivity';
import { Shimmer } from '../../../../shared/view/ui/Shimmer';

import MessageComponent from './MessageComponent';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolActivityProps {
  activity: ToolActivityItem;
  /** The newest activity of a run still in flight: it may name a running call. */
  isLive?: boolean;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

const ToolActivity = memo(function ToolActivity({
  activity,
  isLive = false,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
}: ToolActivityProps) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = useMemo(() => summarizeActivity(activity.messages), [activity.messages]);
  const { label, isRunning } = describeActivity(summary, t, isLive);

  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={activity.timestamp || undefined}>
      <button
        type="button"
        className="flex min-h-6 w-full items-center gap-1 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:text-foreground sm:min-h-7 sm:text-sm"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        {isRunning ? (
          <Shimmer className="min-w-0 truncate motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground">
            {label}
          </Shimmer>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
        {summary.failed > 0 && (
          <span className="flex-shrink-0 text-red-600 dark:text-red-400">
            · {t('activity.failed', { count: summary.failed })}
          </span>
        )}
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 sm:space-y-4">
          {activity.messages.map((message, index) => (
            <MessageComponent
              key={getMessageKey(message)}
              message={message}
              prevMessage={index > 0 ? activity.messages[index - 1] : prevMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default ToolActivity;
