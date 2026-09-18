import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestionIcon, SendHorizontalIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { SideQuestionEntry } from '../../hooks/useSideQuestion';

import { Markdown } from './Markdown';

type SideQuestionSheetProps = {
  open: boolean;
  entries: SideQuestionEntry[];
  onAsk: (question: string) => void;
  onClose: () => void;
};

/**
 * Bottom sheet for `/btw`. The conversation stays visible behind it and keeps
 * running; nothing shown here is stored, so closing the sheet is the discard.
 */
export default function SideQuestionSheet({ open, entries, onAsk, onClose }: SideQuestionSheetProps) {
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
      <DialogContent className="bottom-0 left-1/2 top-auto max-h-[80dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-3xl border-border/80 bg-popover p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <DialogTitle className="sr-only">Side question</DialogTitle>

        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
            <MessageCircleQuestionIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Side question
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              Answered beside the conversation — nothing here is saved
            </p>
          </div>
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
