import { useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';

import type { ChatMessage } from '../../types/types';
import {
  downloadMarkdown,
  downloadHTML,
  downloadPDF,
  EXPORT_FORMATS,
  type ExportOptions,
} from '../../utils/chatExport';

type ChatExportMenuProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  assistantLabel: string;
  hasMoreMessages: boolean;
  isLoadingAllMessages: boolean;
  loadAllMessages: () => Promise<ChatMessage[] | null>;
};

export default function ChatExportMenu({
  messages,
  sessionTitle,
  assistantLabel,
  hasMoreMessages,
  isLoadingAllMessages,
  loadAllMessages,
}: ChatExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [includeToolCalls, setIncludeToolCalls] = useState(false);
  const [includeToolResults, setIncludeToolResults] = useState(false);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (messages.length === 0) {
    return null;
  }

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
      includeToolCalls,
      includeToolResults,
      includeThinking,
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
    setIsOpen(false);
  };

  const busy = isPreparing || isLoadingAllMessages;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Export chat"
        title="Export chat"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
      >
        <Download className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border/50 bg-card shadow-lg">
          <div className="p-2">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Include:</div>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
              <input
                type="checkbox"
                checked={includeToolCalls}
                onChange={(event) => {
                  setIncludeToolCalls(event.target.checked);
                  if (!event.target.checked) setIncludeToolResults(false);
                }}
              />
              <span>Tool calls</span>
            </label>
            <label className={`flex min-h-9 items-center gap-2 rounded-md px-3 py-2 pl-7 text-sm ${includeToolCalls ? 'cursor-pointer text-foreground hover:bg-muted' : 'cursor-not-allowed text-muted-foreground'}`}>
              <input
                type="checkbox"
                checked={includeToolResults}
                disabled={!includeToolCalls}
                onChange={(event) => setIncludeToolResults(event.target.checked)}
              />
              <span>Tool results</span>
            </label>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
              <input
                type="checkbox"
                checked={includeThinking}
                onChange={(event) => setIncludeThinking(event.target.checked)}
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
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-50"
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
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
}
