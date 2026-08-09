import { PanelLeftOpen } from 'lucide-react';

import type { MobileMenuButtonProps } from '../../types/types';
import { useMobileMenuHandlers } from '../../hooks/useMobileMenuHandlers';

export default function MobileMenuButton({ onMenuClick, compact = false }: MobileMenuButtonProps) {
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  const buttonClasses = compact
    ? 'p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent/60 pwa-menu-button'
    : 'p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent/60 touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0';

  return (
    <button
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className={buttonClasses}
      aria-label="Open sidebar"
    >
      <PanelLeftOpen className="h-5 w-5" />
    </button>
  );
}
