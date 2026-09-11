import { useState } from 'react';
import { FileJson, FileText } from 'lucide-react';

import type { ChatMessage } from '../../types/types';
import {
  downloadMarkdown,
  downloadHTML,
  downloadPDF,
  EXPORT_FORMATS,
  type ChatExportInclude,
  type ExportOptions,
} from '../../utils/chatExport';

type ChatExportSource = {
  messages: ChatMessage[];
  sessionTitle?: string;
  assistantLabel: string;
  hasMoreMessages: boolean;
  isLoadingAllMessages: boolean;
  loadAllMessages: () => Promise<ChatMessage[] | null>;
};

type ChatExportOptionsProps = ChatExportSource & {
  include: ChatExportInclude;
  onIncludeChange: (include: ChatExportInclude) => void;
  onExported: () => void;
};

// Touch-sized below md.
const ROW_CLASS_NAME = 'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm md:min-h-9';

/** What to include and which format to write; shared by every place export is offered. */
export function ChatExportOptions({
  messages,
  sessionTitle,
  assistantLabel,
  hasMoreMessages,
  isLoadingAllMessages,
  loadAllMessages,
  include,
  onIncludeChange,
  onExported,
}: ChatExportOptionsProps) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (format: 'markdown' | 'html' | 'pdf') => {
    setExportError(null);
    setIsPreparing(true);

    // PDF windows must open during the click gesture or mobile browsers can
    // block them while the complete transcript is loading.
    const preparedPDFWindow = format === 'pdf' && hasMoreMessages
      ? window.open('', '', 'width=800,height=600')
      : undefined;
    if (format === 'pdf' && hasMoreMessages && !preparedPDFWindow) {
      setExportError('PDF export was blocked. Allow popups and try again.');
      setIsPreparing(false);
      return;
    }

    let exportMessages = messages;
    if (hasMoreMessages) {
      const completeMessages = await loadAllMessages();
      if (!completeMessages) {
        preparedPDFWindow?.close();
        setExportError('The complete session could not be loaded. Nothing was exported.');
        setIsPreparing(false);
        return;
      }
      exportMessages = completeMessages;
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${sessionTitle || 'chat'}-${timestamp}`;
    const options: Partial<ExportOptions> = {
      assistantLabel,
      includeToolCalls: include.toolCalls,
      includeToolResults: include.toolResults,
      includeThinking: include.thinking,
    };

    switch (format) {
      case 'markdown':
        downloadMarkdown(exportMessages, `${filename}.md`, sessionTitle, options);
        break;
      case 'html':
        downloadHTML(exportMessages, `${filename}.html`, sessionTitle, options);
        break;
      case 'pdf':
        downloadPDF(exportMessages, filename, sessionTitle, options, preparedPDFWindow ?? undefined);
        break;
    }
    setIsPreparing(false);
    onExported();
  };

  const busy = isPreparing || isLoadingAllMessages;

  return (
    <div className="p-2">
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Include:</div>
      <label className={`${ROW_CLASS_NAME} cursor-pointer text-foreground hover:bg-muted`}>
        <input
          type="checkbox"
          checked={include.toolCalls}
          onChange={(event) => onIncludeChange({
            ...include,
            toolCalls: event.target.checked,
            toolResults: event.target.checked && include.toolResults,
          })}
        />
        <span>Tool calls</span>
      </label>
      <label className={`${ROW_CLASS_NAME} pl-7 ${include.toolCalls ? 'cursor-pointer text-foreground hover:bg-muted' : 'cursor-not-allowed text-muted-foreground'}`}>
        <input
          type="checkbox"
          checked={include.toolResults}
          disabled={!include.toolCalls}
          onChange={(event) => onIncludeChange({ ...include, toolResults: event.target.checked })}
        />
        <span>Tool results</span>
      </label>
      <label className={`${ROW_CLASS_NAME} cursor-pointer text-foreground hover:bg-muted`}>
        <input
          type="checkbox"
          checked={include.thinking}
          onChange={(event) => onIncludeChange({ ...include, thinking: event.target.checked })}
        />
        <span>Reasoning</span>
      </label>
      <div className="my-1 border-t border-border/50" />
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Export as:</div>
      {EXPORT_FORMATS.map((fmt) => (
        <button
          key={fmt.id}
          type="button"
          disabled={busy}
          onClick={() => void handleExport(fmt.id as 'markdown' | 'html' | 'pdf')}
          className={`${ROW_CLASS_NAME} w-full text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-50`}
        >
          {fmt.id === 'markdown' ? (
            <FileText className="h-4 w-4" />
          ) : (
            <FileJson className="h-4 w-4" />
          )}
          <span>{fmt.label}</span>
        </button>
      ))}
      {busy && (
        <div className="px-3 py-2 text-xs text-muted-foreground">Preparing complete export…</div>
      )}
      {exportError && (
        <div role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{exportError}</div>
      )}
    </div>
  );
}
