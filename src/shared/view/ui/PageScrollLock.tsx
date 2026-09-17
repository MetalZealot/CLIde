import { useLayoutEffect } from 'react';

let openLocks = 0;

/**
 * Render inside an open full-screen overlay. On phones the chat scrolls the page
 * itself, and without this a drag on the overlay scrolls the chat behind it.
 */
export default function PageScrollLock() {
  useLayoutEffect(() => {
    openLocks += 1;
    document.documentElement.classList.add('page-scroll-locked');
    return () => {
      openLocks -= 1;
      if (openLocks === 0) document.documentElement.classList.remove('page-scroll-locked');
    };
  }, []);

  return null;
}
