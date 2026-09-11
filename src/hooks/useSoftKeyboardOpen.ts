import { useEffect, useState } from 'react';

// A viewport this much shorter than its tallest at the current width is a software
// keyboard, not browser chrome. The S20's keyboard took 339px from the installed
// PWA (measured 2026-09-10).
const KEYBOARD_HEIGHT_THRESHOLD = 150;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function hasTextEntryFocus(): boolean {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * True while a software keyboard covers part of the viewport. Focus alone is not
 * proof: a hardware keyboard, or a software one dismissed without blurring, leaves
 * focus in place, so the visual viewport must also have shrunk.
 */
export function useSoftKeyboardOpen(enabled: boolean): boolean {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsOpen(false);
      return;
    }

    let width = window.innerWidth;
    let tallest = 0;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const height = window.visualViewport?.height ?? window.innerHeight;
      // Rotation changes the keyboard-closed height, so the baseline is per width.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = 0;
      }
      tallest = Math.max(tallest, height);
      setIsOpen(hasTextEntryFocus() && tallest - height > KEYBOARD_HEIGHT_THRESHOLD);
    };

    // Deferred a frame: during focusout, activeElement is still the old element.
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(evaluate);
      }
    };

    evaluate();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      viewport?.removeEventListener('resize', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [enabled]);

  return isOpen;
}
