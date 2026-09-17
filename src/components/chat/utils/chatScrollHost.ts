/**
 * The chat scrolls either its own pane or, on phones, the page itself. These
 * helpers read both hosts the same way.
 */

export const isPageScrollHost = (host: HTMLElement): boolean => host === document.documentElement;

/** The band where messages are readable: the pane, or the page between its sticky bars. */
export function getChatViewportRect(host: HTMLElement): { top: number; bottom: number } {
  if (!isPageScrollHost(host)) {
    const rect = host.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }
  const top = document.querySelector('[data-chat-page-top]')?.getBoundingClientRect().bottom ?? 0;
  const bottom = document.querySelector('[data-chat-page-bottom]')?.getBoundingClientRect().top ?? window.innerHeight;
  return { top, bottom };
}

/** A page scroll is reported on the window, not on the root element. */
export const scrollEventTarget = (host: HTMLElement): HTMLElement | Window =>
  isPageScrollHost(host) ? window : host;
