export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

export type TerminalPrefs = {
  fontSize: number;
  cursorStyle: TerminalCursorStyle;
  copyOnSelect: boolean;
};

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;

const PREFS_KEY = 'clide-terminal-prefs';
const DEFAULT_PREFS: TerminalPrefs = { fontSize: 14, cursorStyle: 'block', copyOnSelect: false };

export function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)));
}

function load(): TerminalPrefs {
  let stored: Partial<TerminalPrefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<TerminalPrefs>;
  } catch {
    // Corrupt or unavailable; defaults.
  }
  return {
    fontSize: Number.isFinite(stored.fontSize) ? clampFontSize(stored.fontSize as number) : DEFAULT_PREFS.fontSize,
    cursorStyle: stored.cursorStyle === 'bar' || stored.cursorStyle === 'underline' ? stored.cursorStyle : 'block',
    copyOnSelect: stored.copyOnSelect === true,
  };
}

let prefs: TerminalPrefs | null = null;
const listeners = new Set<() => void>();

/** Per-device terminal preferences, shared by every terminal in every checkout. */
export const terminalPrefs = {
  get(): TerminalPrefs {
    prefs ??= load();
    return prefs;
  },
  set(patch: Partial<TerminalPrefs>): void {
    const next = { ...terminalPrefs.get(), ...patch };
    next.fontSize = clampFontSize(next.fontSize);
    prefs = next;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Kept for this page only.
    }
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
