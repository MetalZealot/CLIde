import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

/** Open state and focus handling for a button that opens a menu (APG menu button). */
export function useMenuButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Keyboard-opened menus take focus and hand it back on close.
  const openedByKeyboardRef = useRef(false);

  const close = useCallback(() => {
    setIsOpen(false);
    if (openedByKeyboardRef.current) {
      buttonRef.current?.focus();
    }
  }, []);

  const toggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // A click from Enter or Space has no pointer, so its detail is 0.
    openedByKeyboardRef.current = event.detail === 0;
    setIsOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (!isOpen || !openedByKeyboardRef.current) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => firstItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  return { buttonRef, firstItemRef, isOpen, toggle, close };
}
