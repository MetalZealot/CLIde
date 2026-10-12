import { useCallback, useRef, useState, useEffect } from 'react';

import type { MainContentHeaderProps } from '../../types/types';
import { useHeaderMenuSection, useSetHeaderAccessorySlot, useSetHeaderBannerSlot } from '../../../../contexts/HeaderMenuContext';

import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle, { getSessionTitle } from './MainContentTitle';
import MainContentHeaderMenu from './MainContentHeaderMenu';
import HeaderSheet from './HeaderSheet';

/** Where the visible view may portal a bar under the header; it sits inside the sticky top, so open rows pin below it. */
export function HeaderBannerSlot() {
  const setBannerSlot = useSetHeaderBannerSlot();
  return <div ref={setBannerSlot ?? undefined} className="relative z-40 empty:hidden" />;
}

/** Where the visible view may portal a control, left of the header menu. */
export function HeaderAccessorySlot() {
  const setAccessorySlot = useSetHeaderAccessorySlot();
  return <div ref={setAccessorySlot ?? undefined} className="flex items-center empty:hidden" />;
}

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  checkoutLabel,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
  otherSessionsStatus,
}: MainContentHeaderProps) {
  const headerMenuSection = useHeaderMenuSection();
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState, isMobile]);

  return (
    <>
    <div ref={barRef} className="app-bar select-none border-b border-border/60 bg-background px-3 sm:px-4">
      {headerMenuSection?.headerContent ?? (
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isMobile && <MobileMenuButton onMenuClick={onMenuClick} otherSessionsStatus={otherSessionsStatus} />}
            <MainContentHeaderMenu
              fullTitle={activeTab === 'chat' && selectedSession ? getSessionTitle(selectedSession) : undefined}
            >
              <MainContentTitle
                activeTab={activeTab}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                checkoutLabel={checkoutLabel}
                hasMenu={Boolean(headerMenuSection?.items.length || headerMenuSection?.status)}
              />
            </MainContentHeaderMenu>
          </div>

          {/* Mobile switches views from the bottom bar instead. */}
          {!isMobile && (
            <div className="relative min-w-0 flex-shrink overflow-hidden sm:flex-shrink-0">
              {canScrollLeft && (
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
              )}
              <div
                ref={scrollRef}
                onScroll={updateScrollState}
                className="scrollbar-hide overflow-x-auto"
              >
                <MainContentTabSwitcher
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  shouldShowBrowserTab={shouldShowBrowserTab}
                />
              </div>
              {canScrollRight && (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
              )}
            </div>
          )}
          <div className="flex flex-shrink-0 items-center">
            <HeaderAccessorySlot />
          </div>
        </div>
      )}
    </div>
    <HeaderSheet anchorRef={barRef} enabled={isMobile} />
    </>
  );
}
