import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface BashCommandDisplayProps {
  command: string;
  description?: string;
  /** Combined stdout/stderr from the tool result (empty while running). */
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  defaultOpen?: boolean;
}

/**
 * Codex-in-VSCode style command row: a compact, single-line command with a
 * chevron on the left. When the command produced output, the row becomes a
 * dropdown that expands to reveal the output inline. Theme-integrated surfaces
 * keep it clean in both light and dark mode; consecutive commands stack tightly
 * into a clean list.
 */
export const BashCommandDisplay: React.FC<BashCommandDisplayProps> = ({
  command,
  description,
  output,
  isError = false,
  status,
  defaultOpen = false,
}) => {
  const trimmedOutput = (output || '').replace(/\s+$/, '');
  const hasOutput = trimmedOutput.length > 0;
  const isMultilineCommand = command.includes('\n');
  const outputLineCount = hasOutput ? trimmedOutput.split('\n').length : 0;
  const isRunning = status === 'running';
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // The header is a summary: one truncated line, never a scroll surface — a
  // 16px row is impossible to drag, and its retained scrollLeft would clip the
  // text once collapsing swaps the overflow away. Anything the ellipsis hides
  // is read in the expanded block instead, so overflow alone makes a row
  // expandable even when the command produced no output.
  const commandRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  useEffect(() => {
    const element = commandRef.current;
    if (!element) return;
    const measure = () => setIsOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [command]);
  const canExpand = hasOutput || isMultilineCommand || isOverflowing;

  // Output often arrives after this component first mounts, so apply the
  // auto-open intent once when there is finally something to show. After that
  // the user is in control of the toggle. Errors intentionally do NOT
  // auto-expand — the red border and status badge already signal the failure,
  // and the output stays one click away.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoAppliedRef.current && hasOutput && defaultOpen) {
      autoAppliedRef.current = true;
      setOpen(true);
    }
  }, [hasOutput, defaultOpen]);

  const toggle = () => {
    if (canExpand) {
      setOpen((prev) => !prev);
    }
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const didCopy = await copyTextToClipboard(command);
    if (!didCopy) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group/cmd overflow-hidden rounded-lg border bg-muted/40 transition-all duration-200',
        isError ? 'border-red-500/30' : 'border-border/60',
        canExpand && !open && 'hover:border-border hover:bg-muted/60',
        open && 'bg-muted/50 shadow-sm',
      )}
    >
      {/* Command header — clickable when there is output to expand */}
      <div
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (canExpand && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 outline-none',
          canExpand && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        {isRunning ? (
          <span className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 self-start animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-emerald-400" />
        ) : (
          <ChevronRight
            className={cn(
              'mt-px h-3.5 w-3.5 flex-shrink-0 self-start text-muted-foreground/70 transition-transform duration-200',
              open && 'rotate-90',
              !canExpand && 'opacity-0',
            )}
          />
        )}
        <span className="flex-shrink-0 self-start select-none font-mono text-xs font-semibold text-emerald-500 dark:text-emerald-400">
          $
        </span>
        {/* The header is the call's identity, so it carries the same truncated
            command in both states; expanding adds the readable copy below it.
            Not a <code> tag: the global inline-code rule wraps, which would
            render a multi-line command here in full. */}
        <span ref={commandRef} className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {command}
        </span>

        {status && status !== 'running' && <ToolStatusBadge status={status} className="flex-shrink-0" />}

        <button
          onClick={handleCopy}
          onKeyDown={(event) => event.stopPropagation()}
          className="touch:opacity-100 flex-shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground focus:opacity-100 group-hover/cmd:opacity-100"
          title="Copy command"
          aria-label="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {(description || (!open && hasOutput && !isRunning)) && (
        <div className="flex items-center gap-2 px-2.5 pb-1 pl-[2.4rem] leading-none">
          {description && (
            <span className="min-w-0 flex-1 truncate text-[11px] italic leading-none text-muted-foreground/70">
              {description}
            </span>
          )}
          {!open && hasOutput && !isRunning && (
            <span
              className={cn(
                'flex-shrink-0 text-[10px] leading-none tabular-nums text-muted-foreground/70',
                !description && 'ml-auto',
              )}
            >
              {outputLineCount} {outputLineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>
      )}

      {/* Expanded command — full width, capped so a long heredoc scrolls in
          place instead of pushing the conversation off screen. */}
      {open && (
        <pre className="settings-content-enter max-h-72 overflow-auto border-t border-border/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground whitespace-pre">
          {command}
        </pre>
      )}

      {/* Expanded output */}
      {open && hasOutput && (
        <div className="settings-content-enter border-t border-border/50 bg-background/50">
          <pre
            className={cn(
              'max-h-80 overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-relaxed',
              isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {trimmedOutput}
          </pre>
        </div>
      )}
    </div>
  );
};
