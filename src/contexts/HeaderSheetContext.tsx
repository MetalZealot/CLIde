import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type ActiveSheet = { key: string; label: string; onClose: () => void };

type HeaderSheetController = {
  /** A sheet is mounted under the header (phones); otherwise owners fall back to their popovers. */
  enabled: boolean;
  activeKey: string | null;
  body: HTMLElement | null;
  show: (key: string, label: string, onClose: () => void) => void;
  /** Slides the sheet away, then closes its owner and runs `then`. */
  close: (then?: () => void) => void;
  /** The owner closed without the sheet: drop it at once. */
  dismiss: (key: string) => void;
};

type HeaderSheetHost = {
  active: ActiveSheet | null;
  closing: boolean;
  setEnabled: (enabled: boolean) => void;
  setBody: (element: HTMLElement | null) => void;
  close: () => void;
  finishClose: () => void;
};

const ControllerContext = createContext<HeaderSheetController | null>(null);
const HostContext = createContext<HeaderSheetHost | null>(null);

/**
 * One sheet under the header shared by every header control, so opening one
 * swaps the sheet's contents instead of stacking a second sheet.
 */
export function HeaderSheetProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [active, setActiveState] = useState<ActiveSheet | null>(null);
  const [closing, setClosing] = useState(false);
  // Read synchronously by show/close in the same tick as a state change.
  const activeRef = useRef<ActiveSheet | null>(null);
  const thenRef = useRef<Array<() => void>>([]);

  const setActive = useCallback((next: ActiveSheet | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);
  const flushThen = useCallback(() => {
    const pending = thenRef.current;
    thenRef.current = [];
    pending.forEach((fn) => fn());
  }, []);

  const show = useCallback((key: string, label: string, onClose: () => void) => {
    const current = activeRef.current;
    if (current && current.key !== key) current.onClose();
    setClosing(false);
    setActive({ key, label, onClose });
    flushThen();
  }, [setActive, flushThen]);

  const close = useCallback((then?: () => void) => {
    if (then) thenRef.current.push(then);
    if (!activeRef.current) {
      flushThen();
      return;
    }
    setClosing(true);
  }, [flushThen]);

  const finishClose = useCallback(() => {
    const current = activeRef.current;
    setActive(null);
    setClosing(false);
    current?.onClose();
    flushThen();
  }, [setActive, flushThen]);

  const dismiss = useCallback((key: string) => {
    if (activeRef.current?.key !== key) return;
    setActive(null);
    setClosing(false);
    flushThen();
  }, [setActive, flushThen]);

  const closeFromHost = useCallback(() => close(), [close]);

  const controller = useMemo<HeaderSheetController>(
    () => ({ enabled, activeKey: active?.key ?? null, body, show, close, dismiss }),
    [enabled, active?.key, body, show, close, dismiss],
  );
  const host = useMemo<HeaderSheetHost>(
    () => ({ active, closing, setEnabled, setBody, close: closeFromHost, finishClose }),
    [active, closing, closeFromHost, finishClose],
  );

  return (
    <ControllerContext.Provider value={controller}>
      <HostContext.Provider value={host}>{children}</HostContext.Provider>
    </ControllerContext.Provider>
  );
}

export function useHeaderSheetHost() {
  return useContext(HostContext);
}

/**
 * Shows the caller's content in the header sheet while `open`, when the sheet
 * is available. Portal the content into `target`; close through `close` so the
 * sheet slides away before the owner unmounts it.
 */
export function useHeaderSheet(key: string, open: boolean, onClose: () => void, label: string) {
  const controller = useContext(ControllerContext);
  const inSheet = Boolean(controller?.enabled);
  const isActive = controller?.activeKey === key;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!controller || !inSheet) return;
    if (open && !isActive) controller.show(key, label, () => onCloseRef.current());
    else if (!open && isActive) controller.dismiss(key);
  }, [controller, inSheet, open, isActive, key, label]);

  const close = controller?.close;
  return {
    inSheet,
    target: inSheet && isActive ? controller?.body ?? null : null,
    close: useCallback((then?: () => void) => {
      if (close) close(then);
      else then?.();
    }, [close]),
  };
}
