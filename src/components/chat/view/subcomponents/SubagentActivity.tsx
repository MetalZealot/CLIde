import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, SubagentChildTool } from '../../types/types';
import { useHistoryDetail } from '../../hooks/useHistoryDetail';
import { describeOperation, parseToolInput } from '../../utils/toolActivity';
import { formatDuration } from '../../utils/chatFormatting';

import { DetailPanel } from './DetailPanel';
import { DISCLOSED_TEXT_CLASS, DisclosureRow } from './DisclosureRow';
import { Markdown } from './Markdown';
import OperationDetail from './OperationDetail';
import { OperationRow, operationRowClass } from './ToolActivity';

interface SubagentActivityProps {
  message: ChatMessage;
  /** The session is still running, so a call without a result is in flight. */
  isLive: boolean;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
}

const firstLine = (text: string): string => text.split('\n').map((line) => line.trim()).find(Boolean) || '';

/** Agent results arrive as text or as `[{ type: 'text', text }]`, sometimes JSON-encoded. */
function readAgentResultText(content: unknown): string {
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch {
      return content;
    }
  }
  if (Array.isArray(value)) {
    const parts = value.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text);
    if (parts.length > 0) return parts.join('\n');
  }
  if (typeof value === 'string') return value;
  return value == null ? '' : JSON.stringify(value, null, 2);
}

const childMessages = new WeakMap<SubagentChildTool, ChatMessage>();

/** A child call as a chat message, cached so its operation summary is too. */
function toChildMessage(child: SubagentChildTool): ChatMessage {
  let message = childMessages.get(child);
  if (!message) {
    message = {
      id: child.toolId,
      type: 'assistant',
      content: '',
      isToolUse: true,
      toolId: child.toolId,
      toolName: child.toolName,
      toolInput: typeof child.toolInput === 'string' ? child.toolInput : JSON.stringify(child.toolInput ?? {}),
      toolResult: child.toolResult ?? null,
      timestamp: child.timestamp,
    };
    childMessages.set(child, message);
  }
  return message;
}

function TextLine({ label, text, isOpen, onToggle }: { label: string; text: string; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" className={operationRowClass} onClick={onToggle} aria-expanded={isOpen}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {isOpen && (
        <DetailPanel copyText={text}>
          <Markdown className={DISCLOSED_TEXT_CLASS}>{text}</Markdown>
        </DetailPanel>
      )}
    </>
  );
}

/** One row per agent: its type and task, opening to what it was asked, the calls it made, and what it reported. */
const SubagentActivity = memo(function SubagentActivity({ message, isLive, onFileOpen }: SubagentActivityProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const history = useHistoryDetail(message, isOpen);
  const full = history.message;

  const operation = describeOperation(message);
  const input = parseToolInput(message.toolInput);
  const type = String(input?.subagent_type || '').trim() || t('activity.agent.defaultType');
  const description = String(input?.description || '').trim();
  const label = description ? `${type} · ${description}` : type;
  const isRunning = isLive && operation.status === 'running';
  const failure = operation.status === 'error' || operation.status === 'denied' ? operation.status : null;
  const callCount = message.subagentState?.childTools.length ?? 0;

  const prompt = String(parseToolInput(full.toolInput)?.prompt || '').trim();
  const children = useMemo(() => (full.subagentState?.childTools ?? []).map(toChildMessage), [full.subagentState]);
  const result = full.toolResult ? readAgentResultText(full.toolResult.content).trim() : '';

  const details = [
    callCount > 0 ? t('activity.agent.calls', { count: callCount }) : '',
    !isRunning && operation.durationMs !== null && operation.durationMs >= 1000 ? formatDuration(operation.durationMs) : '',
  ].filter(Boolean);

  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
      <DisclosureRow
        label={label}
        isRunning={isRunning}
        isOpen={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
        trailing={(
          <>
            {details.length > 0 && <span className="flex-shrink-0 tabular-nums">· {details.join(' · ')}</span>}
            {failure && <span className="flex-shrink-0 text-red-600 dark:text-red-400">· {t(`activity.status.${failure}`)}</span>}
          </>
        )}
      />

      {isOpen && (
        <div className="ml-1 mt-0.5 border-l border-border pl-3">
          {prompt && (
            <TextLine
              label={t('activity.agent.asked', { text: firstLine(prompt) })}
              text={prompt}
              isOpen={openKeys.has('prompt')}
              onToggle={() => toggle('prompt')}
            />
          )}
          {children.map((child) => {
            const key = `call:${child.toolId}`;
            return (
              <div key={key}>
                <OperationRow message={child} messageKey={key} isOpen={openKeys.has(key)} isLive={isLive} onToggle={toggle} />
                {openKeys.has(key) && <OperationDetail message={child} onFileOpen={onFileOpen} />}
              </div>
            );
          })}
          {result && (
            <TextLine
              label={t('activity.agent.reported', { text: firstLine(result) })}
              text={result}
              isOpen={openKeys.has('result')}
              onToggle={() => toggle('result')}
            />
          )}
          {history.status === 'loading' && (
            <div className="text-xs leading-6 text-muted-foreground" role="status">{t('tools.loadingDetail')}</div>
          )}
          {history.status === 'error' && (
            <div className="flex gap-2 text-xs leading-6 text-red-600 dark:text-red-400" role="alert">
              {t('tools.detailFailed')}
              <button type="button" className="underline" onClick={history.request}>{t('tools.retryDetail')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default SubagentActivity;
