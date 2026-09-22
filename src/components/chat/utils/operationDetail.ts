import type { ChatMessage } from '../types/types';
import { parseSearchResult } from '../tools/configs/toolConfigs';

import { calculateDiff } from './messageTransforms';
import { basename, describeOperation, parseToolInput, readApplyPatchText } from './toolActivity';

export type DetailTone = 'command' | 'output' | 'error' | 'added' | 'removed' | 'gap';

export interface DetailLine {
  text: string;
  tone: DetailTone;
}

export type DetailBlock =
  | { type: 'lines'; lines: DetailLine[]; heading?: string }
  | { type: 'files'; paths: string[] }
  | { type: 'prose'; text: string };

export interface OperationDetail {
  blocks: DetailBlock[];
  /** What the copy button copies. */
  copyText: string;
  /** A file the detail can open in the editor. */
  openPath?: string;
}

const splitLines = (text: unknown): string[] => {
  const value = typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text, null, 2);
  const trimmed = value.replace(/\s+$/, '');
  return trimmed ? trimmed.split('\n') : [];
};

const toLines = (text: unknown, tone: DetailTone): DetailLine[] => splitLines(text).map((line) => ({ text: line, tone }));

/** Changed lines only; `@@` hunk breaks become one gap line. */
function unifiedDiffLines(diff: unknown): DetailLine[] {
  const lines: DetailLine[] = [];
  for (const line of String(diff ?? '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) lines.push({ text: line.slice(1), tone: 'added' });
    else if (line.startsWith('-')) lines.push({ text: line.slice(1), tone: 'removed' });
    else if (line.startsWith('@@') && lines.length > 0 && lines[lines.length - 1].tone !== 'gap') lines.push({ text: '', tone: 'gap' });
  }
  while (lines.length > 0 && lines[lines.length - 1].tone === 'gap') lines.pop();
  return lines;
}

function patchBlocks(patch: string): DetailBlock[] {
  const files: Array<{ path: string; diff: string[] }> = [];
  for (const line of patch.split('\n')) {
    const file = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (file) files.push({ path: file[1].trim(), diff: [] });
    else if (!line.startsWith('***')) files[files.length - 1]?.diff.push(line);
  }
  return diffBlocks(files.map((file) => ({ path: file.path, lines: unifiedDiffLines(file.diff.join('\n')) })));
}

function diffBlocks(files: Array<{ path: string; lines: DetailLine[] }>): DetailBlock[] {
  return files.map((file) => ({
    type: 'lines' as const,
    lines: file.lines,
    heading: files.length > 1 ? basename(file.path) : undefined,
  }));
}

function editBlocks(toolName: string, input: any): DetailBlock[] {
  switch (toolName) {
    case 'Write':
      return [{ type: 'lines', lines: toLines(input?.content, 'added') }];
    case 'FileChanges': {
      const files = Array.isArray(input)
        ? input.map((change: any) => ({ path: String(change?.path || ''), diff: change?.diff }))
        : Object.entries(input && typeof input === 'object' ? input : {})
          .map(([path, change]: [string, any]) => ({ path, diff: change?.unified_diff ?? change?.diff }));
      return diffBlocks(files.map((file: { path: string; diff: unknown }) => ({ path: file.path, lines: unifiedDiffLines(file.diff) })));
    }
    case 'exec':
      return patchBlocks(readApplyPatchText(typeof input === 'string' ? input : ''));
    default:
      return [{
        type: 'lines',
        lines: calculateDiff(String(input?.old_string ?? ''), String(input?.new_string ?? ''))
          .map((line) => ({ text: line.content, tone: line.type === 'added' ? 'added' : 'removed' })),
      }];
  }
}

function inputLines(input: unknown): DetailLine[] {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
      const [first = '', ...rest] = splitLines(value);
      return [{ text: `${key}: ${first}`, tone: 'command' as const }, ...rest.map((text) => ({ text, tone: 'command' as const }))];
    });
  }
  return toLines(input, 'command');
}

const nonEmpty = (blocks: DetailBlock[]): DetailBlock[] =>
  blocks.filter((block) => (block.type === 'lines' ? block.lines.length > 0 : block.type === 'files' ? block.paths.length > 0 : block.text.trim()));

/** Everything one call can show when its line is opened, flattened to lines. */
export function buildOperationDetail(message: ChatMessage): OperationDetail {
  if (message.isThinking) {
    const text = String(message.content || '');
    return { blocks: nonEmpty([{ type: 'prose', text }]), copyText: text };
  }

  const operation = describeOperation(message);
  const input = parseToolInput(message.toolInput);
  const result = message.toolResult;
  const output = result ? toLines(result.content, result.isError ? 'error' : 'output') : [];
  const outputText = result ? splitLines(result.content).join('\n') : '';
  const toolName = String(message.toolName || '');

  switch (operation.kind) {
    case 'bash': {
      const command = splitLines(input?.command).join('\n');
      return {
        blocks: nonEmpty([{ type: 'lines', lines: toLines(command, 'command') }, { type: 'lines', lines: output }]),
        copyText: command,
      };
    }
    case 'poll':
      return { blocks: nonEmpty([{ type: 'lines', lines: output }]), copyText: outputText };
    case 'edit': {
      const blocks = editBlocks(toolName, input);
      const failure = result?.isError ? [{ type: 'lines' as const, lines: output }] : [];
      const copyText = blocks
        .flatMap((block) => (block.type === 'lines' ? block.lines : []))
        .map((line) => `${line.tone === 'added' ? '+' : line.tone === 'removed' ? '-' : ' '}${line.text}`)
        .join('\n');
      return { blocks: nonEmpty([...failure, ...blocks]), copyText };
    }
    case 'read':
      return {
        blocks: nonEmpty([{ type: 'lines', lines: output }]),
        copyText: outputText,
        openPath: operation.paths[0],
      };
    case 'search': {
      const { files } = parseSearchResult(result);
      return {
        blocks: nonEmpty(files.length > 0 && !result?.isError ? [{ type: 'files', paths: files }] : [{ type: 'lines', lines: output }]),
        copyText: files.length > 0 ? files.join('\n') : outputText,
      };
    }
    default:
      return {
        blocks: nonEmpty([{ type: 'lines', lines: inputLines(input) }, { type: 'lines', lines: output }]),
        copyText: outputText || splitLines(input).join('\n'),
      };
  }
}
