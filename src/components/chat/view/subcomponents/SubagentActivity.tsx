import { ArrowLeft } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BottomSheet, PageScrollLock, Shimmer, useCloseOnBack, useSheetAsPopover } from '../../../../shared/view/ui';

import type { ChatMessage, SubagentChildTool } from '../../types/types';
import { useHistoryDetail } from '../../hooks/useHistoryDetail';
import { describeOperation, parseToolInput } from '../../utils/toolActivity';
import { formatDuration } from '../../utils/chatFormatting';

import { DetailPanel } from './DetailPanel';
import { DISCLOSED_TEXT_CLASS, DisclosureRow, rowLabelClass, toggleInPlace } from './DisclosureRow';
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

const isAsyncLaunch = (toolUseResult: unknown): boolean => {
  const record = toolUseResult as { status?: unknown; isAsync?: unknown } | null | undefined;
  return record?.status === 'async_launched' || record?.isAsync === true;
};

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
    <div>
      <button type="button" className={operationRowClass(isOpen)} onClick={(event) => toggleInPlace(event.currentTarget, onToggle)} aria-expanded={isOpen}>
        <span className={`${rowLabelClass(isOpen)} flex-1`}>{label}</span>
      </button>
      {isOpen && (
        <DetailPanel copyText={text}>
          <Markdown className={DISCLOSED_TEXT_CLASS}>{text}</Markdown>
        </DetailPanel>
      )}
    </div>
  );
}

/** What the row and the full-screen view both say about an agent. */
function useAgentSummary(message: ChatMessage, isLive: boolean) {
  const { t } = useTranslation('chat');
  const operation = describeOperation(message);
  const input = parseToolInput(message.toolInput);
  const type = String(input?.subagent_type || '').trim() || t('activity.agent.defaultType');
  const description = String(input?.description || '').trim();
  const agent = message.subagentState?.agentStatus;
  const isRunning = isLive && (agent ? agent.state === 'running' : operation.status === 'running');
  const failure = agent?.state === 'failed' || agent?.state === 'stopped'
    ? agent.state
    : operation.status === 'error' || operation.status === 'denied' ? operation.status : null;
  const callCount = Math.max(message.subagentState?.childTools.length ?? 0, agent?.toolUses ?? 0);
  // A notice sent while the agent still has work of its own carries an interim duration.
  const durationMs = agent?.durationMs != null || operation.durationMs != null
    ? Math.max(agent?.durationMs ?? 0, operation.durationMs ?? 0) : null;
  const details = [
    callCount > 0 ? t('activity.agent.calls', { count: callCount }) : '',
    !isRunning && durationMs != null && durationMs >= 1000 ? formatDuration(durationMs) : '',
  ].filter(Boolean);
  return { type, description, label: description ? `${type} · ${description}` : type, isRunning, failure, details };
}

type ViewerFrameProps = {
  label: string;
  title: string;
  subtitle?: string;
  isMono?: boolean;
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  /** Inside a popover rather than full screen. */
  embedded?: boolean;
  children: ReactNode;
};

/** A detail view with a back arrow: full screen, or filling the popover it sits in. Escape goes back. */
export function ViewerFrame({ label, title, subtitle, isMono = false, backLabel, onBack, action, embedded = false, children }: ViewerFrameProps) {
  useEffect(() => {
    // Window capture runs before a dialog's document listener; stopped, so an enclosing sheet or popover stays open.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onBack]);

  const content = (
    <>
      <div className={`${embedded ? 'h-12' : 'app-bar'} flex shrink-0 select-none items-center gap-1 border-b border-border/60 px-2 sm:px-3`}>
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{title}</span>
          {subtitle && <span className={`truncate text-sm text-muted-foreground ${isMono ? 'font-mono' : ''}`}>{subtitle}</span>}
        </div>
        {action}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 ${embedded ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:px-6'}`}>
        {children}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col" role="group" aria-label={label}>{content}</div>;
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={label}>
      <PageScrollLock />
      {content}
    </div>,
    document.body,
  );
}

interface AgentViewerProps extends SubagentActivityProps {
  onClose: () => void;
  embedded?: boolean;
}

/** An agent's whole transcript; whoever opens it owns the back-gesture entry. */
export function AgentViewer({ message, isLive, onFileOpen, onClose, embedded = false }: AgentViewerProps) {
  const { t } = useTranslation('chat');
  const { type, description, label, isRunning, failure, details } = useAgentSummary(message, isLive);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const history = useHistoryDetail(message, true);
  const full = history.message;

  const prompt = String(parseToolInput(full.toolInput)?.prompt || '').trim();
  const children = useMemo(() => (full.subagentState?.childTools ?? []).map(toChildMessage), [full.subagentState]);
  // A background agent's call result is only its launch receipt; its report comes separately.
  const launchOnly = isAsyncLaunch(full.toolResult?.toolUseResult) || isAsyncLaunch(message.toolResult?.toolUseResult);
  const result = (message.subagentState?.report
    ?? (full.toolResult && !launchOnly ? readAgentResultText(full.toolResult.content) : '')).trim();

  return (
    <ViewerFrame label={label} title={type} subtitle={description || undefined} backLabel={t('activity.agent.back')} onBack={onClose} embedded={embedded}>
      <div className="flex gap-1.5 py-1 text-chat-meta text-muted-foreground">
        {isRunning && <Shimmer>{`${t('claudeStatus.actions.working', { defaultValue: 'Working' })}…`}</Shimmer>}
        {details.length > 0 && <span className="tabular-nums">{isRunning ? '· ' : ''}{details.join(' · ')}</span>}
        {failure && <span className="text-red-600 dark:text-red-400">· {t(`activity.status.${failure}`)}</span>}
      </div>
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
        <section className="mt-4">
          <h3 className="mb-1 text-chat-meta font-medium uppercase tracking-wide text-muted-foreground">{t('activity.agent.report')}</h3>
          <Markdown>{result}</Markdown>
        </section>
      )}
      {history.status === 'loading' && (
        <div className="text-chat-meta leading-6 text-muted-foreground" role="status">{t('tools.loadingDetail')}</div>
      )}
      {history.status === 'error' && (
        <div className="flex gap-2 text-chat-meta leading-6 text-red-600 dark:text-red-400" role="alert">
          {t('tools.detailFailed')}
          <button type="button" className="underline" onClick={history.request}>{t('tools.retryDetail')}</button>
        </div>
      )}
    </ViewerFrame>
  );
}

/** One row per agent at its launch point; it opens the agent in a full-height sheet on a phone, full screen wider. */
const SubagentActivity = memo(function SubagentActivity({ message, isLive, onFileOpen }: SubagentActivityProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const asPopover = useSheetAsPopover();
  useCloseOnBack(isOpen && asPopover, close);
  const { label, isRunning, failure, details } = useAgentSummary(message, isLive);

  return (
    <div className="chat-message tool px-1 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
      <DisclosureRow
        label={label}
        isRunning={isRunning}
        isOpen={false}
        onToggle={() => setIsOpen(true)}
        trailing={(
          <>
            {details.length > 0 && <span className="flex-shrink-0 tabular-nums">· {details.join(' · ')}</span>}
            {failure && <span className="flex-shrink-0 text-red-600 dark:text-red-400">· {t(`activity.status.${failure}`)}</span>}
          </>
        )}
      />
      {asPopover ? (
        isOpen && <AgentViewer message={message} isLive={isLive} onFileOpen={onFileOpen} onClose={close} />
      ) : (
        <BottomSheet open={isOpen} onClose={close} title={label} expandable expanded>
          {isOpen && <AgentViewer message={message} isLive={isLive} onFileOpen={onFileOpen} onClose={close} embedded />}
        </BottomSheet>
      )}
    </div>
  );
});

export default SubagentActivity;
