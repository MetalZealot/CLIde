import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type HeaderMenuItemBase = {
  key: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  isDanger?: boolean;
  showDividerBefore?: boolean;
};

export type HeaderMenuItem = HeaderMenuItemBase & (
  | { onSelect: () => void; renderPanel?: never }
  /** Opens in place of the menu, anchored to the same button, for choices a flat item can't hold. */
  | { renderPanel: (close: () => void) => ReactNode; onSelect?: never }
);

export type HeaderMenuSection = {
  /** One line of view state shown above the actions, such as a connection. */
  status?: { text: string; isOk: boolean } | null;
  items: HeaderMenuItem[];
};

const SectionContext = createContext<HeaderMenuSection | null>(null);
const SetSectionContext = createContext<
  ((update: (current: HeaderMenuSection | null) => HeaderMenuSection | null) => void) | null
>(null);

/** Lets the visible view put its own actions in the header menu. */
export function HeaderMenuProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<HeaderMenuSection | null>(null);
  return (
    <SetSectionContext.Provider value={setSection}>
      <SectionContext.Provider value={section}>{children}</SectionContext.Provider>
    </SetSectionContext.Provider>
  );
}

export function useHeaderMenuSection(): HeaderMenuSection | null {
  return useContext(SectionContext);
}

/**
 * Publishes the calling view's actions while `section` is non-null. Memoize it.
 * Clears only its own section, so a hidden view that stays mounted can't wipe
 * the one the visible view published.
 */
export function useRegisterHeaderMenu(section: HeaderMenuSection | null) {
  const setSection = useContext(SetSectionContext);

  useEffect(() => {
    if (!setSection || !section) {
      return undefined;
    }
    setSection(() => section);
    return () => setSection((current) => (current === section ? null : current));
  }, [setSection, section]);
}
