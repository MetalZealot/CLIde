import { ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useSidebarSwipe } from '../../hooks/useSidebarSwipe';

interface MobileSidebarOverlayProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Mobile sidebar as a sliding overlay with drag-to-follow open/close.
 * Rendered only on mobile; the swipe hook drives the panel imperatively while
 * `isOpen` stays the settled state that governs the resting classes.
 */
export default function MobileSidebarOverlay({
  isOpen,
  onOpen,
  onClose,
  children,
}: MobileSidebarOverlayProps) {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);

  useSidebarSwipe({
    enabled: true,
    isOpen,
    onOpen,
    onClose,
    containerRef,
    panelRef,
    backdropRef,
  });

  return (
    <div
      ref={containerRef}
      // In standalone PWA mode the global `.fixed.inset-0` rule (index.css)
      // pushes every full-screen overlay down by the header/safe-area inset.
      // For this drawer we want the opposite: it should run edge-to-edge to the
      // true top of the viewport (like a native side sheet) so its own surface
      // fills the status-bar strip instead of leaving a mismatched bar there.
      // The status bar is cleared by padding the sidebar header content, not the
      // panel, so nothing important hides behind it.
      style={{ top: 0 }}
      className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
        isOpen ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <button
        ref={backdropRef}
        // Same override as the container: the scrim must reach the true top edge
        // so the darkening is uniform right up under the status bar.
        style={{ top: 0 }}
        className="fixed inset-0 bg-black/50 transition-opacity duration-150 ease-out"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onTouchStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
      />
      <div
        ref={panelRef}
        className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
