import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Whether a single-line `truncate` element is currently clipping its text.
 *
 * Re-measures on element resize, so the answer survives the sidebar being
 * dragged wider or narrower.
 */
export function useIsTruncated<T extends HTMLElement>() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!element) {
      setIsTruncated(false);
      return;
    }

    const measure = () => setIsTruncated(element.scrollWidth > element.clientWidth);
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(element);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, isTruncated };
}

export default useIsTruncated;
