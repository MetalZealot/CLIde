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

// Mask rather than a coloured overlay, so the fade follows the bubble's own colour and ring.
const FADE = 'linear-gradient(to bottom, black calc(100% - 2.5em), transparent)';
const clipStyle = (clampHeight: number) => ({
  maxHeight: `${clampHeight}px`, overflow: 'hidden', maskImage: FADE, WebkitMaskImage: FADE,
});
const HIDDEN = { display: 'none' };

/** Clamps tall message text to its first lines behind a chevron, per the collapse setting. */
export default function CollapsibleMessageText({ children }: CollapsibleMessageTextProps) {
  const { t } = useTranslation('chat');
  const enabled = useUiPreference('collapseLongMessages');
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const [clampHeight, setClampHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const lineSource = content.querySelector<HTMLElement>('.chat-reading') ?? content;
    const lineHeight = parseFloat(getComputedStyle(lineSource).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    const tooTall = content.offsetHeight > lineHeight * COLLAPSE_AFTER_LINES;
    const nextClamp = tooTall ? lineHeight * COLLAPSED_LINES : null;
    // Chat scroll restore reads layout before this state's render lands, so the DOM takes the
    // final height now; the render then writes the same values.
    const clip = clipRef.current;
    if (clip) {
      const collapse = nextClamp !== null && !expandedRef.current;
      clip.style.maxHeight = collapse ? `${nextClamp}px` : '';
      clip.style.overflow = collapse ? 'hidden' : '';
      clip.style.setProperty('mask-image', collapse ? FADE : '');
      clip.style.setProperty('-webkit-mask-image', collapse ? FADE : '');
      clip.toggleAttribute('data-collapsed-message', collapse);
    }
    if (chevronRef.current) chevronRef.current.style.display = nextClamp === null ? 'none' : '';
    setClampHeight(nextClamp);
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

  return (
    <>
      <div
        ref={clipRef}
        data-collapsed-message={collapsed ? '' : undefined}
        style={collapsed ? clipStyle(clampHeight) : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {/* Always mounted, so the measuring pass can show it before its render lands. */}
      {enabled && (
        <button
          ref={chevronRef}
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? t('collapsedMessage.collapse') : t('collapsedMessage.expand')}
          title={expanded ? t('collapsedMessage.collapse') : t('collapsedMessage.expand')}
          className="-mb-1 flex w-full justify-center py-1 opacity-80 transition-opacity hover:opacity-100"
          style={collapsible ? undefined : HIDDEN}
        >
          {expanded
            ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </>
  );
}
