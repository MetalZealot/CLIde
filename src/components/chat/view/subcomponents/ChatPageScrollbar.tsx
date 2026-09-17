import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { getChatViewportRect } from '../../utils/chatScrollHost';

const HIDE_AFTER_MS = 900;
const MIN_THUMB_PX = 32;

/**
 * The page's own scrollbar spans the whole screen, bars included, so it is
 * hidden and this thumb travels only the band between the sticky header and
 * composer. Samsung Internet will not hide the page scrollbar; there it stays.
 */
export default function ChatPageScrollbar({ contentRef }: { contentRef: RefObject<HTMLElement> }) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const keepsNativeScrollbar = document.documentElement.classList.contains('samsung-browser');

  useEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb || keepsNativeScrollbar) return;
    const root = document.documentElement;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const draw = () => {
      const { top, bottom } = getChatViewportRect(root);
      const band = bottom - top;
      const maxScroll = root.scrollHeight - root.clientHeight;
      if (maxScroll <= 0 || band <= 0) {
        thumb.style.height = '0px';
        return;
      }
      const height = Math.max(MIN_THUMB_PX, (band * band) / (band + maxScroll));
      const progress = Math.min(1, Math.max(0, root.scrollTop / maxScroll));
      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${top + (band - height) * progress}px)`;
    };

    const onScroll = () => {
      draw();
      thumb.dataset.visible = 'true';
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        thumb.dataset.visible = 'false';
      }, HIDE_AFTER_MS);
    };

    const content = contentRef.current;
    const observer = content && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    if (observer && content) observer.observe(content);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', draw);
    draw();

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', draw);
    };
  }, [contentRef, keepsNativeScrollbar]);

  if (keepsNativeScrollbar) return null;

  return (
    <div
      ref={thumbRef}
      aria-hidden="true"
      data-visible="false"
      className="pointer-events-none fixed right-0.5 top-0 z-40 w-1 select-none rounded-full bg-foreground/40 opacity-0 transition-opacity duration-300 data-[visible=true]:opacity-100 data-[visible=true]:duration-0"
    />
  );
}
