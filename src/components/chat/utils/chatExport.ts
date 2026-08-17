import type { ChatMessage, ToolResult } from '../types/types';

export interface ExportOptions {
  includeMeta: boolean;
  assistantLabel: string;
  includeToolCalls: boolean;
  includeToolResults: boolean;
  includeThinking: boolean;
}

type ResolvedExportOptions = ExportOptions;

type ExportEntry = {
  kind: 'user' | 'assistant' | 'error' | 'tool';
  label: string;
  content: string;
  timestamp?: string | number | Date;
  toolInput?: string;
  toolResult?: string;
  toolResultIsError?: boolean;
};

const DEFAULT_EXPORT_OPTIONS: ResolvedExportOptions = {
  includeMeta: true,
  assistantLabel: 'Assistant',
  includeToolCalls: false,
  includeToolResults: false,
  includeThinking: false,
};

function resolveExportOptions(options: Partial<ExportOptions>): ResolvedExportOptions {
  const resolved = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  return {
    ...resolved,
    includeToolResults: resolved.includeToolCalls && resolved.includeToolResults,
  };
}

/** Format a timestamp for display in exports. */
function formatTimestamp(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stringifyExportValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toToolEntry(
  toolName: string | undefined,
  toolInput: unknown,
  toolResult: ToolResult | null | undefined,
  timestamp: string | number | Date | undefined,
  includeToolResults: boolean,
): ExportEntry {
  return {
    kind: 'tool',
    label: toolName?.trim() || 'Tool',
    content: '',
    timestamp,
    toolInput: stringifyExportValue(toolInput),
    toolResult: includeToolResults && toolResult
      ? stringifyExportValue(toolResult.content ?? toolResult.toolUseResult)
      : undefined,
    toolResultIsError: includeToolResults && Boolean(toolResult?.isError),
  };
}

function projectExportEntries(
  messages: ChatMessage[],
  options: ResolvedExportOptions,
): ExportEntry[] {
  const entries: ExportEntry[] = [];

  for (const message of messages) {
    if (message.isToolUse) {
      if (!options.includeToolCalls) continue;

      entries.push(toToolEntry(
        message.toolName,
        message.toolInput,
        message.toolResult,
        message.timestamp,
        options.includeToolResults,
      ));

      for (const child of message.subagentState?.childTools ?? []) {
        entries.push(toToolEntry(
          child.toolName,
          child.toolInput,
          child.toolResult,
          child.timestamp,
          options.includeToolResults,
        ));
      }
      continue;
    }

    if (message.isThinking && !options.includeThinking) continue;

    const content = stringifyExportValue(message.content);
    if (!content.trim()) continue;

    if (message.type === 'user') {
      entries.push({ kind: 'user', label: 'You', content, timestamp: message.timestamp });
    } else if (message.type === 'assistant') {
      entries.push({
        kind: 'assistant',
        label: message.isThinking ? `${options.assistantLabel} reasoning` : options.assistantLabel,
        content,
        timestamp: message.timestamp,
      });
    } else if (message.type === 'error') {
      entries.push({ kind: 'error', label: 'Error', content, timestamp: message.timestamp });
    } else if (message.type === 'tool' && options.includeToolCalls) {
      entries.push({ kind: 'tool', label: 'Tool', content, timestamp: message.timestamp });
    }
  }

  return entries;
}

function markdownCodeBlock(value: string): string {
  const longestFence = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  return `${fence}\n${value}\n${fence}`;
}

/** Convert messages to Markdown using the provider-neutral export projection. */
export function exportToMarkdown(
  messages: ChatMessage[],
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): string {
  const resolved = resolveExportOptions(options);
  let markdown = '';

  if (resolved.includeMeta) {
    markdown += `# ${sessionTitle || 'Chat Export'}\n\n`;
    markdown += `**Exported:** ${formatTimestamp(new Date())}\n\n`;
    markdown += '---\n\n';
  }

  for (const entry of projectExportEntries(messages, resolved)) {
    const icon = entry.kind === 'error' ? '⚠️ ' : entry.kind === 'tool' ? '🔧 ' : '';
    markdown += `## ${icon}${entry.label}\n\n`;

    if (entry.content) markdown += `${entry.content}\n\n`;
    if (entry.toolInput) markdown += `**Input**\n\n${markdownCodeBlock(entry.toolInput)}\n\n`;
    if (entry.toolResult !== undefined) {
      markdown += `**${entry.toolResultIsError ? 'Error result' : 'Result'}**\n\n${markdownCodeBlock(entry.toolResult)}\n\n`;
    }

    if (resolved.includeMeta && entry.timestamp) {
      markdown += `<small>${formatTimestamp(entry.timestamp)}</small>\n\n`;
    }
    markdown += '---\n\n';
  }

  return markdown;
}

/** Export messages to a downloadable Markdown file. */
export function downloadMarkdown(
  messages: ChatMessage[],
  filename: string = 'chat-export.md',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  const content = exportToMarkdown(messages, sessionTitle, options);
  const blob = new Blob([content], { type: 'text/markdown' });
  downloadBlob(blob, filename);
}

function renderHTMLContent(entry: ExportEntry): string {
  const content = entry.content
    ? `<p style="margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #555; font-size: 14px; line-height: 1.6;">${escapeHTML(entry.content)}</p>`
    : '';
  const input = entry.toolInput
    ? `<h4 style="margin: 12px 0 6px;">Input</h4><pre style="white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHTML(entry.toolInput)}</pre>`
    : '';
  const result = entry.toolResult !== undefined
    ? `<h4 style="margin: 12px 0 6px; color: ${entry.toolResultIsError ? '#b91c1c' : '#333'};">${entry.toolResultIsError ? 'Error result' : 'Result'}</h4><pre style="white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHTML(entry.toolResult)}</pre>`
    : '';
  return `${content}${input}${result}`;
}

/** Export messages to HTML for download or browser PDF printing. */
export function exportToHTML(
  messages: ChatMessage[],
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): string {
  const resolved = resolveExportOptions(options);
  const htmlContent = projectExportEntries(messages, resolved)
    .map((entry) => {
      const icon = entry.kind === 'user' ? '👤 ' : entry.kind === 'assistant' ? '🤖 ' : entry.kind === 'tool' ? '🔧 ' : '⚠️ ';
      const time = resolved.includeMeta && entry.timestamp
        ? `<p style="font-size: 12px; color: #999; margin-top: 8px;">${formatTimestamp(entry.timestamp)}</p>`
        : '';

      return `
        <div style="margin-bottom: 24px; padding: 16px; border-radius: 8px; background-color: ${entry.kind === 'user' ? '#e3f2fd' : '#f5f5f5'};">
          <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #333;">${icon}${escapeHTML(entry.label)}</h3>
          ${renderHTMLContent(entry)}
          ${time}
        </div>
      `;
    })
    .join('');

  const exportMeta = resolved.includeMeta
    ? `<div class="meta">Exported on ${formatTimestamp(new Date())}</div><div class="divider"></div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHTML(sessionTitle || 'Chat Export')}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 24px;
            background-color: #fafafa;
            color: #333;
          }
          h1 { margin: 0 0 8px 0; }
          .meta { color: #999; font-size: 13px; margin-bottom: 24px; }
          .divider { border-top: 1px solid #ddd; margin: 24px 0; }
          pre { margin: 0; padding: 10px; border-radius: 6px; background: #e5e7eb; color: #333; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>${escapeHTML(sessionTitle || 'Chat Export')}</h1>
        ${exportMeta}
        ${htmlContent}
      </body>
    </html>
  `;
}

/** Export messages to a downloadable HTML file. */
export function downloadHTML(
  messages: ChatMessage[],
  filename: string = 'chat-export.html',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  const content = exportToHTML(messages, sessionTitle, options);
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, filename);
}

/** Word-compatible fallback; true DOCX generation requires another library. */
export function downloadWord(
  messages: ChatMessage[],
  _filename: string = 'chat-export.html',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  downloadHTML(messages, 'chat-export.html', sessionTitle, options);
}

/** Open browser print UI for PDF export. */
export function downloadPDF(
  messages: ChatMessage[],
  _filename: string = 'chat-export',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
  targetWindow?: Window,
): void {
  const htmlContent = exportToHTML(messages, sessionTitle, options);
  const win = targetWindow ?? window.open('', '', 'width=800,height=600');
  if (!win) {
    window.alert('PDF export could not start because the browser blocked the popup. Allow popups and try again.');
    return;
  }

  win.document.write(htmlContent);
  win.document.close();
  setTimeout(() => win.print(), 250);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const EXPORT_FORMATS = [
  { id: 'markdown', label: 'Markdown (.md)', ext: '.md' },
  { id: 'html', label: 'Web Page (.html)', ext: '.html' },
  { id: 'pdf', label: 'PDF (Print to File)', ext: '.pdf' },
] as const;
