import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilIcon, XIcon } from 'lucide-react';

import type { QueuedAsyncAnswer } from '../../utils/asyncQuestionState';

interface QueuedMessagesRowProps {
  /** The typed message waiting for this turn to end; it sends before any answer. */
  draft: { content: string; attachmentCount: number } | null;
  /** Answers to Codex questions, oldest first, one per later turn. */
  answers: QueuedAsyncAnswer[];
  onEditDraft: () => void;
  onDeleteDraft: () => void;
  onRemoveAnswer: (answerId: string) => void;
}

type QueuedItem =
  | { kind: 'draft'; key: string; summary: string }
  | { kind: 'answer'; key: string; summary: string; question: string };

const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Everything queued, in send order, as one row: the next message with its actions, the rest behind "+N more". */
export default function QueuedMessagesRow({
  draft,
  answers,
  onEditDraft,
  onDeleteDraft,
  onRemoveAnswer,
}: QueuedMessagesRowProps) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const items: QueuedItem[] = [
    ...(draft
      ? [{
        kind: 'draft' as const,
        key: 'draft',
        summary: draft.content.trim() || t('input.queue.attachmentsOnly', {
          count: draft.attachmentCount,
          defaultValue: draft.attachmentCount === 1 ? '{{count}} file' : '{{count}} files',
        }),
      }]
      : []),
    ...answers.map((answer) => ({
      kind: 'answer' as const,
      key: answer.id,
      summary: `${answer.question} — ${answer.answer}`,
      question: answer.question,
    })),
  ];
  const [next, ...rest] = items;
  const hasRest = rest.length > 0;

  useEffect(() => {
    if (!hasRest) setIsExpanded(false);
  }, [hasRest]);

  useEffect(() => {
    if (!isExpanded) return;
    // On click, not pointerdown: collapsing reflows the page, and a tap that
    // moved its target before release would never reach what was tapped.
    const collapseOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsExpanded(false);
    };
    const collapseOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false);
    };
    document.addEventListener('click', collapseOutside);
    document.addEventListener('keydown', collapseOnEscape);
    return () => {
      document.removeEventListener('click', collapseOutside);
      document.removeEventListener('keydown', collapseOnEscape);
    };
  }, [isExpanded]);

  if (!next) return null;

  const actionsFor = (item: QueuedItem) => (item.kind === 'draft' ? (
    <>
      <button
        type="button"
        onClick={() => {
          setIsExpanded(false);
          onEditDraft();
        }}
        aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
        title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
        className={`${iconButton} hover:bg-accent hover:text-foreground`}
      >
        <PencilIcon className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDeleteDraft}
        aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
        title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
        className={`${iconButton} hover:bg-destructive/10 hover:text-destructive`}
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => onRemoveAnswer(item.key)}
      aria-label={t('followUpQuestions.removeQueued', {
        defaultValue: 'Remove queued answer to {{question}}',
        question: item.question,
      })}
      title={t('followUpQuestions.removeQueued', {
        defaultValue: 'Remove queued answer to {{question}}',
        question: item.question,
      })}
      className={`${iconButton} hover:bg-destructive/10 hover:text-destructive`}
    >
      <XIcon className="h-4 w-4" aria-hidden />
    </button>
  ));

  return (
    // Reversed so the list sits above the row but follows it in tab order.
    <div ref={rootRef} className="settings-content-enter mx-auto mb-2 flex max-w-[54.25rem] flex-col-reverse">
      <div className="flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] py-1 pl-3 pr-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-primary/70">
          {t('input.queue.label', { defaultValue: 'Queued' })}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{next.summary}</span>
        {hasRest && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={listId}
            onClick={() => setIsExpanded((value) => !value)}
            className="shrink-0 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('input.queue.more', { count: rest.length, defaultValue: '+{{count}} more' })}
          </button>
        )}
        <div className="flex shrink-0 items-center">{actionsFor(next)}</div>
      </div>

      {isExpanded && hasRest && (
        <ul
          id={listId}
          aria-label={t('input.queue.listLabel', { defaultValue: 'Also queued, in send order' })}
          className="mb-1 overflow-hidden rounded-xl border border-border bg-popover shadow-sm"
        >
          {rest.map((item) => (
            <li key={item.key} className="flex items-center gap-1 border-b border-border/60 py-1 pl-3 pr-1 last:border-b-0">
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">{item.summary}</p>
              {actionsFor(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
