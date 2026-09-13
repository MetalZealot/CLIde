import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatFindController } from '../../hooks/useChatFind';

const BUTTON_CLASS = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35';

export default function ChatFindBar({ controller }: { controller: ChatFindController }) {
  const { t } = useTranslation('chat');
  const inputRef = useRef<HTMLInputElement>(null);
  // Header registration trails input events; the mounted field owns its draft.
  const [draft, setDraft] = useState(controller.query);
  const setQuery = (value: string) => {
    setDraft(value);
    controller.setQuery(value);
  };
  const canNavigate = draft === controller.query && !controller.isPreparing && !controller.loadFailed && controller.total > 0;
  const visibleCurrent = controller.currentIndex >= 0 ? controller.currentIndex + 1 : 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resultLabel = controller.isPreparing
    ? t('findInChat.loading', { defaultValue: 'Loading…' })
    : t('findInChat.resultCount', {
        defaultValue: '{{current}} of {{total}}',
        current: visibleCurrent,
        total: controller.total,
      });

  return (
    <div className="mx-auto flex h-11 w-full min-w-0 max-w-[54.25rem] items-center rounded-xl bg-muted/65">
      <button
        type="button"
        aria-label={t('findInChat.close', { defaultValue: 'Close find in chat' })}
        className={BUTTON_CLASS}
        onClick={controller.close}
      >
        <ArrowLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor="chat-find-input">
          {t('findInChat.inputLabel', { defaultValue: 'Find in chat' })}
        </label>
        <input
          ref={inputRef}
          id="chat-find-input"
          data-chat-find-input
          type="search"
          name="chat-find"
          autoComplete="off"
          enterKeyHint="search"
          value={draft}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            if (!canNavigate) return;
            if (event.shiftKey) {
              controller.previous();
            } else {
              controller.next();
            }
          }}
          placeholder={t('findInChat.placeholder', { defaultValue: 'Find in chat' })}
          className="chat-find-input h-11 w-full min-w-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex min-w-[4.5rem] shrink-0 items-center justify-end px-1 text-xs tabular-nums text-muted-foreground"
      >
        {controller.loadFailed ? (
          <button
            type="button"
            onClick={controller.retryLoad}
            className="flex min-h-9 items-center gap-1 rounded-md px-2 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('findInChat.retry', { defaultValue: 'Retry' })}
          </button>
        ) : controller.isPreparing ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {resultLabel}
          </span>
        ) : draft && draft === controller.query ? resultLabel : null}
      </div>

      {draft && (
        <button
          type="button"
          aria-label={t('findInChat.clear', { defaultValue: 'Clear search' })}
          className={BUTTON_CLASS}
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
        >
          <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        aria-label={t('findInChat.next', { defaultValue: 'Next match' })}
        className={BUTTON_CLASS}
        disabled={!canNavigate}
        onClick={controller.next}
      >
        <ChevronDown className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t('findInChat.previous', { defaultValue: 'Previous match' })}
        className={BUTTON_CLASS}
        disabled={!canNavigate}
        onClick={controller.previous}
      >
        <ChevronUp className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
