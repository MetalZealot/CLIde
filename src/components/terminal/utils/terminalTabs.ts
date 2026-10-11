import { TerminalSession } from './terminalSession';

export type TerminalTab = {
  /** Shown after the shell name once there are two or more tabs; the lowest free number. */
  n: number;
  session: TerminalSession;
};

export type TerminalTabsSnapshot = {
  tabs: TerminalTab[];
  active: TerminalTab;
  /** The last closed tab, restorable until its undo window ends. */
  closed: TerminalTab | null;
};

type StoredTabs = { tabs: Array<{ n: number; id: string | null }>; active: number };

const STORAGE_PREFIX = 'clide-terminal-tabs:';
const LEGACY_PREFIX = 'clide-terminal-session:';
const UNDO_MS = 8000;

function readStored(cwd: string): StoredTabs | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${cwd}`);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredTabs;
      const tabs = Array.isArray(parsed?.tabs)
        ? parsed.tabs.filter((tab) => Number.isInteger(tab?.n) && tab.n > 0)
        : [];
      if (tabs.length > 0) {
        return { tabs, active: Number(parsed.active) };
      }
    }
    const legacy = localStorage.getItem(`${LEGACY_PREFIX}${cwd}`);
    if (legacy) {
      localStorage.removeItem(`${LEGACY_PREFIX}${cwd}`);
      return { tabs: [{ n: 1, id: legacy }], active: 1 };
    }
  } catch {
    // Corrupt or unavailable; one fresh terminal.
  }
  return null;
}

/** Every terminal open in one checkout, kept across view switches so scrollback and sockets survive. */
export class TerminalTabs {
  private readonly cwd: string;
  private readonly listeners = new Set<() => void>();
  private snapshot: TerminalTabsSnapshot;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private closedIndex = 0;

  constructor(cwd: string) {
    this.cwd = cwd;
    const stored = readStored(cwd) ?? { tabs: [{ n: 1, id: null }], active: 1 };
    const tabs = stored.tabs.map(({ n, id }) => this.createTab(n, id));
    this.snapshot = { tabs, active: tabs.find((tab) => tab.n === stored.active) ?? tabs[0], closed: null };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TerminalTabsSnapshot => this.snapshot;

  private update(patch: Partial<TerminalTabsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private createTab(n: number, serverSessionId: string | null): TerminalTab {
    return { n, session: new TerminalSession(this.cwd, serverSessionId, () => this.persist()) };
  }

  private persist(): void {
    const stored: StoredTabs = {
      tabs: this.snapshot.tabs.map(({ n, session }) => ({ n, id: session.serverSessionId })),
      active: this.snapshot.active.n,
    };
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${this.cwd}`, JSON.stringify(stored));
    } catch {
      // Storage unavailable; a reload starts fresh.
    }
  }

  add(): void {
    const used = new Set(this.snapshot.tabs.map((tab) => tab.n));
    let n = 1;
    while (used.has(n)) n += 1;
    const tab = this.createTab(n, null);
    this.update({ tabs: [...this.snapshot.tabs, tab], active: tab });
  }

  select(tab: TerminalTab): void {
    if (tab !== this.snapshot.active && this.snapshot.tabs.includes(tab)) this.update({ active: tab });
  }

  /** False for the last tab, which Restart replaces instead. The PTY lives until the undo window ends. */
  close(tab: TerminalTab): boolean {
    const { tabs, active } = this.snapshot;
    const index = tabs.indexOf(tab);
    if (index < 0 || tabs.length < 2) return false;
    this.finishClose();
    const remaining = tabs.filter((other) => other !== tab);
    this.closedIndex = index;
    this.undoTimer = setTimeout(() => this.finishClose(), UNDO_MS);
    this.update({
      tabs: remaining,
      active: active === tab ? remaining[Math.max(0, index - 1)] : active,
      closed: tab,
    });
    return true;
  }

  undoClose(): void {
    const { closed, tabs } = this.snapshot;
    if (!closed) return;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    const restored = [...tabs];
    restored.splice(Math.min(this.closedIndex, restored.length), 0, closed);
    this.update({ tabs: restored, active: closed, closed: null });
  }

  /** Ends the pending close now; its toast is gone. */
  finishClose(): void {
    const { closed } = this.snapshot;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    if (!closed) return;
    closed.session.dispose();
    this.update({ closed: null });
  }
}

export function shellName(shell: string | null): string {
  return shell?.split(/[\\/]/).pop() || 'shell';
}

/** The shell's name alone while it is the only terminal, numbered once there are more. */
export function tabLabel(tab: TerminalTab, tabCount: number, fallbackShell: string | null = null): string {
  const name = shellName(tab.session.getSnapshot().shell ?? fallbackShell);
  return tabCount > 1 ? `${name} ${tab.n}` : name;
}

const checkouts = new Map<string, TerminalTabs>();

export function getTerminalTabs(cwd: string): TerminalTabs {
  let tabs = checkouts.get(cwd);
  if (!tabs) {
    tabs = new TerminalTabs(cwd);
    checkouts.set(cwd, tabs);
  }
  return tabs;
}
