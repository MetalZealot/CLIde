import * as React from 'react';

const BACK_MARKER = '__clideSheet';
/** An overlay opened from inside another, such as an agent opened from the background-work sheet. */
const NESTED_BACK_MARKER = '__clideSheetNested';

/**
 * One history entry while open, so Android's back gesture closes the overlay
 * instead of leaving the page. Closing any other way drops the entry, unless a
 * navigation has since covered it. A nested overlay takes its own entry, so back
 * closes it and leaves the one beneath open.
 */
export function useCloseOnBack(open: boolean, onBack: () => void, { nested = false }: { nested?: boolean } = {}) {
  const marker = nested ? NESTED_BACK_MARKER : BACK_MARKER;
  const openRef = React.useRef(open);
  openRef.current = open;
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  React.useEffect(() => {
    if (!open) return undefined;
    if (!window.history.state?.[marker]) {
      window.history.pushState({ [marker]: true }, '');
    }
    let popped = false;
    const handlePopState = () => {
      // Still on our entry: the pop closed an overlay above this one.
      if (window.history.state?.[marker]) return;
      popped = true;
      onBackRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Deferred so StrictMode's remount keeps the entry it would otherwise pop.
      window.setTimeout(() => {
        if (!popped && !openRef.current && window.history.state?.[marker]) {
          window.history.back();
        }
      }, 0);
    };
  }, [open, marker]);
}
