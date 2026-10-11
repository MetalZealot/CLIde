import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Where the chat's last activity line is: the running turn's line, else the latest turn summary, else a bare row. */
type SlotKind = 'live' | 'summary' | 'fallback';
type Slots = Record<SlotKind, HTMLElement | null>;
type Register = (kind: SlotKind, element: HTMLElement, attach: boolean) => void;

const RegisterContext = createContext<Register | null>(null);
const SlotContext = createContext<HTMLElement | null>(null);

export function ActivityLineSlotProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ live: null, summary: null, fallback: null });
  const register = useCallback<Register>((kind, element, attach) => {
    setSlots((current) => {
      if (attach) return current[kind] === element ? current : { ...current, [kind]: element };
      // A row handing the slot on may detach after its successor attached.
      return current[kind] === element ? { ...current, [kind]: null } : current;
    });
  }, []);
  const slot = slots.live ?? slots.summary ?? slots.fallback;
  return (
    <RegisterContext.Provider value={register}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
    </RegisterContext.Provider>
  );
}

/** The element at the right end of the chat's last activity line, for a control to portal into. */
export function useActivityLineSlot(): HTMLElement | null {
  return useContext(SlotContext);
}

export function ActivityLineSlot({ kind }: { kind: SlotKind }) {
  const register = useContext(RegisterContext);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!register || !element) return undefined;
    register(kind, element, true);
    return () => register(kind, element, false);
  }, [register, kind, element]);
  return <span ref={setElement} className="ml-auto flex shrink-0 items-center empty:hidden" />;
}
