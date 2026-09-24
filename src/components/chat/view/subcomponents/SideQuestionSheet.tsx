import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, GitForkIcon, MessageCircleQuestionIcon, SendHorizontalIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { SideQuestionEntry } from '../../hooks/useSideQuestion';
import { copyTextToClipboard } from '../../../../utils/clipboard';

import { Markdown } from './Markdown';

type SideQuestionSheetProps = {
  open: boolean;
  entries: SideQuestionEntry[];
  onAsk: (question: string) => void;
  onClose: () => void;
  onClear: () => void;
  /** Rejects with the reason the fork failed. */
  onFork: (entryId: string) => Promise<void>;
};

function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyTextToClipboard(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
      aria-label={copied ? 'Copied' : 'Copy answer'}
      className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Starts a new session: the main conversation, then this exchange as its last turn. */
function ForkAnswerButton({ onFork }: { onFork: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onFork();
          } catch (forkError) {
            setError(forkError instanceof Error ? forkError.message : 'That side question could not be forked.');
          } finally {
            setBusy(false);
          }
        }}
        aria-label="Fork into a new session"
        className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <GitForkIcon className="h-3.5 w-3.5" />
        {busy ? 'Forking…' : 'Fork'}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}

/**
 * Bottom sheet for `/btw`. The conversation stays visible behind it and keeps
 * running. Closing only hides the history; Clear is the discard.
 */
export default function SideQuestionSheet({ open, entries, onAsk, onClose, onClear, onFork }: SideQuestionSheetProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [open, entries]);

  const submit = () => {
    const question = draft.trim();
    if (!question) {
      return;
    }
    setDraft('');
    onAsk(question);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="bottom-0 left-1/2 top-auto flex max-h-[80dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-3xl border-border/80 bg-popover p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <DialogTitle className="sr-only">Side question</DialogTitle>

        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
            <MessageCircleQuestionIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Side questions
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              Not added to the conversation
            </p>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              Ask anything about what is happening. The run keeps going.
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="mb-4 last:mb-0">
                <p className="text-sm font-semibold text-foreground">{entry.question}</p>
                {entry.status === 'pending' && (
                  <p className="mt-1 animate-pulse text-sm text-muted-foreground">Asking…</p>
                )}
                {entry.status === 'failed' && (
                  <p className="mt-1 text-sm text-destructive">{entry.error}</p>
                )}
                {entry.status === 'answered' && (
                  <>
                    <Markdown className="mt-1 text-sm">{entry.answer || ''}</Markdown>
                    {entry.fallbackNotice && (
                      <p className="mt-1 text-xs text-muted-foreground">{entry.fallbackNotice}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <CopyAnswerButton text={entry.answer || ''} />
                      <ForkAnswerButton onFork={() => onFork(entry.id)} />
                    </div>
                  </>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <Input
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a side question…"
            className="h-10"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Ask"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          >
            <SendHorizontalIcon className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
