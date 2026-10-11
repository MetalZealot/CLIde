import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TerminalSession, TerminalSnapshot } from '../utils/terminalSession';

/** Find in the visible terminal's output: Enter steps to the next match, Shift+Enter back, Escape closes. */
export default function TerminalSearchBar({ session, result, onClose }: {
  session: TerminalSession;
  result: TerminalSnapshot['search'];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-runs against whichever terminal is showing, and clears its highlights when it stops showing.
  useEffect(() => {
    if (queryRef.current) session.search(queryRef.current, 'next', true);
    return () => session.clearSearch();
  }, [session]);

  let count = '';
  if (query && result) {
    if (result.count === 0) count = t('terminal.search.none');
    else count = result.index >= 0 ? `${result.index + 1}/${result.count}` : String(result.count);
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 py-[5px]">
      <Search aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          session.search(event.target.value, 'next', true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            session.search(query, event.shiftKey ? 'prev' : 'next');
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={t('terminal.search.placeholder')}
        aria-label={t('terminal.search.placeholder')}
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-[13px] text-foreground outline-none focus:border-primary"
      />
      {count && <small className="flex-none text-xs text-muted-foreground">{count}</small>}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('terminal.search.close')}
        className="grid h-[30px] w-[34px] flex-none place-items-center rounded-lg text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
