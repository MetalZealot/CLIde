import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { useUiPreference } from '../../../../hooks/useUiPreferences';
import { CHAT_FIND_REVEAL_EVENT } from '../../hooks/useChatFind';

const COLLAPSED_LINES = 8;
// Two lines of slack so the chevron never hides a line or two it could have shown.
const COLLAPSE_AFTER_LINES = 10;

type CollapsibleMessageTextProps = {
  children: ReactNode;
};

/** Clamps tall message text to its first lines behind a chevron, per the collapse setting. */
export default function CollapsibleMessageText({ children }: CollapsibleMessageTextProps) {
  const { t } = useTranslation('chat');
  const enabled = useUiPreference('collapseLongMessages');
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [clampHeight, setClampHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const lineSource = content.querySelector<HTMLElement>('.chat-reading') ?? content;
    const lineHeight = parseFloat(getComputedStyle(lineSource).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    const tooTall = content.offsetHeight > lineHeight * COLLAPSE_AFTER_LINES;
    setClampHeight(tooTall ? lineHeight * COLLAPSED_LINES : null);
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    measure();
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, measure]);

  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return undefined;
    const reveal = () => setExpanded(true);
    clip.addEventListener(CHAT_FIND_REVEAL_EVENT, reveal);
    return () => clip.removeEventListener(CHAT_FIND_REVEAL_EVENT, reveal);
  }, []);

  const collapsible = enabled && clampHeight !== null;
  const collapsed = collapsible && !expanded;
  // Mask rather than a coloured overlay, so the fade follows the bubble's own colour and ring.
  const fade = 'linear-gradient(to bottom, black calc(100% - 2.5em), transparent)';

  return (
    <>
      <div
        ref={clipRef}
        data-collapsed-message={collapsed ? '' : undefined}
        className={collapsed ? 'overflow-hidden' : undefined}
        style={collapsed ? { maxHeight: clampHeight, maskImage: fade, WebkitMaskImage: fade } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? t('collapsedMessage.collapse') : t('collapsedMessage.expand')}
          title={expanded ? t('collapsedMessage.collapse') : t('collapsedMessage.expand')}
          className="-mb-1 flex w-full justify-center py-1 text-white/80 transition-colors hover:text-white"
        >
          {expanded
            ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </>
  );
}
