import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type HeaderMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  isDanger?: boolean;
};

export type HeaderMenuSection = {
  /** One line of view state shown above the actions, such as a connection. */
  status?: { text: string; isOk: boolean } | null;
  items: HeaderMenuItem[];
};

const SectionContext = createContext<HeaderMenuSection | null>(null);
const SetSectionContext = createContext<((section: HeaderMenuSection | null) => void) | null>(null);

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

/** Publishes the calling view's actions while it is mounted. Memoize `section`. */
export function useRegisterHeaderMenu(section: HeaderMenuSection | null) {
  const setSection = useContext(SetSectionContext);

  useEffect(() => {
    if (!setSection) {
      return undefined;
    }
    setSection(section);
    return () => setSection(null);
  }, [setSection, section]);
}
