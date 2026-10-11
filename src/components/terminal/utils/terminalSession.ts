import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';

import { IS_PLATFORM } from '../../../constants/config';
import { getStoredAuthToken } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';
import {
  installMobileTerminalSelection,
  type MobileTerminalSelectionManager,
} from '../../shell/utils/mobileTerminalSelection';
import { createTerminalClipboardAddon } from '../../shell/utils/terminalClipboard';
import { ensureXtermFocusStyles } from '../../shell/utils/terminalStyles';

import { MAX_FONT_SIZE, MIN_FONT_SIZE, terminalPrefs, type TerminalPrefs } from './terminalPrefs';

// Ported from upstream's cloudcli-plugin-terminal (session.ts, protocol 2): binary
// frames are PTY bytes, text frames are JSON control, and `seq` counts bytes
// rendered so a reconnect asks the server for only what it missed.

/** `idle` until the terminal is first shown; a restored background tab connects when picked. */
export type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'exited' | 'error';

export type TerminalSnapshot = {
  status: TerminalStatus;
  exitCode: number | null;
  error: string | null;
  shell: string | null;
  pendingCtrl: boolean;
  pendingAlt: boolean;
  /** Matches for the last search; null when no search is showing. */
  search: { index: number; count: number } | null;
};

type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'ready'; sessionId: string; shell: string; cwd: string; resumed: boolean; reset: boolean; seq: number }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

const CONNECT_TIMEOUT_MS = 12_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const PING_INTERVAL_MS = 25_000;
const FIT_DEBOUNCE_MS = 60;
/** Close code the server sends when another socket took this PTY. */
const CLAIMED_ELSEWHERE_CODE = 4409;

const encoder = new TextEncoder();

const DARK_THEME: ITheme = {
  background: '#141414', foreground: '#d4d4d4', cursor: '#ffffff', cursorAccent: '#141414',
  selectionBackground: '#264f78', selectionForeground: '#ffffff',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
};

const LIGHT_THEME: ITheme = {
  background: '#fbfaf7', foreground: '#383a42', cursor: '#383a42', cursorAccent: '#fbfaf7',
  selectionBackground: '#d4d9e3', selectionForeground: '#383a42',
  black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
  blue: '#0184bc', magenta: '#a626a4', cyan: '#0997b3', white: '#fafafa',
  brightBlack: '#6b6f7c', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401',
  brightBlue: '#0184bc', brightMagenta: '#a626a4', brightCyan: '#0997b3', brightWhite: '#ffffff',
};

function buildSocketUrl(): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/terminal`;
  }
  // Read per attempt: the token rotates, and a cached copy fails every reconnect after a rotation.
  const token = getStoredAuthToken();
  return token ? `${protocol}//${window.location.host}/terminal?token=${encodeURIComponent(token)}` : null;
}

const DARK_SEARCH: ISearchOptions['decorations'] = {
  matchBackground: '#5f5f00', matchBorder: '#e5e510', matchOverviewRuler: '#e5e510',
  activeMatchBackground: '#e5e510', activeMatchBorder: '#ffffff', activeMatchColorOverviewRuler: '#ffffff',
};

const LIGHT_SEARCH: ISearchOptions['decorations'] = {
  matchBackground: '#fde68a', matchBorder: '#d97706', matchOverviewRuler: '#d97706',
  activeMatchBackground: '#f59e0b', activeMatchBorder: '#383a42', activeMatchColorOverviewRuler: '#383a42',
};

/**
 * One plain shell for one checkout: an xterm plus the socket feeding it. The socket
 * reconnects on its own (backoff, plus an immediate retry when the page is visible
 * or back online) and resumes the same server PTY by id.
 */
export class TerminalSession {
  readonly element: HTMLDivElement;

  private readonly cwd: string;
  private readonly onServerSessionChange: () => void;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private searchAddon: SearchAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribePrefs: (() => void) | null = null;
  private disposed = false;
  private mobileSelection: MobileTerminalSelectionManager | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: TerminalSnapshot = {
    status: 'idle', exitCode: null, error: null, shell: null, pendingCtrl: false, pendingAlt: false, search: null,
  };

  private ws: WebSocket | null = null;
  serverSessionId: string | null;
  private seq = 0;
  private everConnected = false;
  private restarting = false;
  private dark = true;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingsAwaitingPong = 0;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCols = 0;
  private lastRows = 0;

  private readonly onOnline = (): void => {
    if (this.snapshot.status === 'reconnecting') this.connect();
  };

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible' && this.snapshot.status === 'reconnecting') this.connect();
  };

  /** `serverSessionId` resumes an existing PTY; `onServerSessionChange` fires whenever it changes, for persisting. */
  constructor(cwd: string, serverSessionId: string | null, onServerSessionChange: () => void) {
    this.cwd = cwd;
    this.serverSessionId = serverSessionId;
    this.onServerSessionChange = onServerSessionChange;
    this.element = document.createElement('div');
    this.element.className = 'h-full w-full';
  }

  // ── Observation (useSyncExternalStore) ─────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TerminalSnapshot => this.snapshot;

  private update(patch: Partial<TerminalSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ── Mounting ───────────────────────────────────────────────────────────────

  /** xterm measures its cells on open, so it opens on the first attach, once the element is in the page. */
  attachTo(container: HTMLElement): void {
    if (this.disposed) return;
    container.appendChild(this.element);
    if (!this.terminal) {
      this.open();
      this.connect();
      return;
    }
    window.setTimeout(() => {
      if (!this.terminal) return;
      this.terminal.refresh(0, this.terminal.rows - 1);
      this.fit(true);
    }, 30);
  }

  detach(): void {
    this.element.remove();
  }

  private open(): void {
    ensureXtermFocusStyles();
    const prefs = terminalPrefs.get();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: prefs.fontSize,
      cursorStyle: prefs.cursorStyle,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      // No convertEol: the PTY already applies ONLCR, and doubling it breaks vim, htop and less.
      theme: this.dark ? DARK_THEME : LIGHT_THEME,
    });
    this.terminal = terminal;
    this.fitAddon = new FitAddon();
    terminal.loadAddon(this.fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(createTerminalClipboardAddon());
    this.searchAddon = new SearchAddon();
    terminal.loadAddon(this.searchAddon);
    this.searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      if (this.snapshot.search) this.update({ search: { index: resultIndex, count: resultCount } });
    });
    terminal.open(this.element);
    this.loadWebgl();

    // Pinch-zoom writes the shared preference, so the settings sheet and other terminals follow.
    this.mobileSelection = installMobileTerminalSelection(terminal, this.element, {
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      onFontSizeChange: (fontSize) => terminalPrefs.set({ fontSize }),
    });
    this.unsubscribePrefs = terminalPrefs.subscribe(() => this.applyPrefs(terminalPrefs.get()));

    terminal.onData((data) => this.handleInput(data));
    terminal.onBinary((data) => this.sendBytes(latin1ToBytes(data)));
    // Search highlights its match by selecting it, which must not copy.
    terminal.onSelectionChange(() => {
      if (terminalPrefs.get().copyOnSelect && !this.snapshot.search && terminal.hasSelection()) {
        void copyTextToClipboard(terminal.getSelection());
      }
    });
    terminal.attachCustomKeyEventHandler((event) => this.handleKey(event));

    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(this.element);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private applyPrefs(prefs: TerminalPrefs): void {
    if (!this.terminal) return;
    this.terminal.options.cursorStyle = prefs.cursorStyle;
    if (this.terminal.options.fontSize !== prefs.fontSize) {
      this.terminal.options.fontSize = prefs.fontSize;
      this.fit(true);
    }
  }

  private loadWebgl(): void {
    if (!this.terminal) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => addon.dispose());
      this.terminal.loadAddon(addon);
    } catch {
      // No WebGL; xterm keeps its DOM renderer.
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private connect(): void {
    if (!this.terminal || this.disposed) return;
    this.clearTimers();
    this.dropSocket();
    this.update({ status: this.everConnected && !this.restarting ? 'reconnecting' : 'connecting', error: null });

    const url = buildSocketUrl();
    if (!url) {
      this.update({ status: 'error', error: 'Not signed in' });
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    // A socket that opens but never completes the handshake would otherwise wait forever.
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && this.snapshot.status !== 'connected') {
        ws.close();
        this.scheduleReconnect();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onmessage = (event: MessageEvent) => this.handleMessage(ws, event);
    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws || this.snapshot.status === 'exited') return;
      this.stopPing();
      if (event.code === CLAIMED_ELSEWHERE_CODE) {
        // Another tab took this PTY; taking it back would trade it forever, so start a fresh shell.
        this.forgetServerSession();
        this.restarting = true;
        this.terminal?.reset();
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose always follows and owns the retry.
    };
  }

  private dropSocket(): void {
    const stale = this.ws;
    if (!stale) return;
    this.ws = null;
    stale.onopen = null;
    stale.onclose = null;
    stale.onerror = null;
    stale.onmessage = null;
    try {
      stale.close();
    } catch {
      // Already closed.
    }
  }

  private handleMessage(ws: WebSocket, event: MessageEvent): void {
    if (this.ws !== ws || !this.terminal) return;

    if (typeof event.data !== 'string') {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      this.seq += bytes.byteLength;
      this.terminal.write(bytes);
      return;
    }

    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'hello':
        this.fit(true);
        this.send({
          type: 'init',
          sessionId: this.serverSessionId ?? undefined,
          seq: this.seq,
          cwd: this.cwd,
          cols: this.terminal.cols,
          rows: this.terminal.rows,
        });
        break;
      case 'ready': {
        const expired = !message.resumed && this.serverSessionId !== null && !this.restarting;
        this.restarting = false;
        if (message.reset || expired) this.terminal.reset();
        this.seq = message.seq;
        if (this.serverSessionId !== message.sessionId) {
          this.serverSessionId = message.sessionId;
          this.onServerSessionChange();
        }
        this.reconnectAttempts = 0;
        this.everConnected = true;
        this.clearTimers();
        this.startPing();
        this.update({ status: 'connected', exitCode: null, error: null, shell: message.shell });
        if (expired) {
          this.terminal.write('\x1b[2m--- Previous shell ended; started a new one. ---\x1b[0m\r\n');
        }
        window.setTimeout(() => this.fit(true), 30);
        break;
      }
      case 'exit':
        this.forgetServerSession();
        this.stopPing();
        this.clearTimers();
        this.update({ status: 'exited', exitCode: message.exitCode });
        break;
      case 'error':
        this.update({ status: 'error', error: message.message });
        break;
      case 'pong':
        this.pingsAwaitingPong = 0;
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.snapshot.status === 'exited') return;
    this.clearTimers();
    this.update({ status: 'reconnecting' });
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private forgetServerSession(): void {
    const had = this.serverSessionId !== null;
    this.serverSessionId = null;
    this.seq = 0;
    if (had) this.onServerSessionChange();
  }

  /** Abandons the current PTY and starts a fresh shell. */
  restart(): void {
    if (this.serverSessionId) this.send({ type: 'close' });
    this.forgetServerSession();
    this.restarting = true;
    this.reconnectAttempts = 0;
    this.terminal?.reset();
    this.update({ exitCode: null });
    this.connect();
  }

  /** Ends the PTY and releases everything this terminal holds; the instance is dead afterwards. */
  dispose(): void {
    if (this.disposed) return;
    if (this.serverSessionId) this.send({ type: 'close' });
    this.disposed = true;
    this.clearTimers();
    this.stopPing();
    this.dropSocket();
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.resizeObserver?.disconnect();
    this.unsubscribePrefs?.();
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.mobileSelection?.dispose();
    this.terminal?.dispose();
    this.terminal = null;
    this.element.remove();
    this.listeners.clear();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendBytes(bytes: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  /** A modifier armed on the key bar applies to the next character typed, so Ctrl+anything works from a phone. */
  private handleInput(data: string): void {
    const { pendingCtrl, pendingAlt } = this.snapshot;
    if ((pendingCtrl || pendingAlt) && data.length === 1) {
      let out = data;
      if (pendingCtrl) {
        const code = out.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) out = String.fromCharCode(code - 96);
        else if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64);
      }
      if (pendingAlt) out = `\x1b${out}`;
      this.update({ pendingCtrl: false, pendingAlt: false });
      this.sendBytes(encoder.encode(out));
      return;
    }
    this.sendBytes(encoder.encode(data));
  }

  toggleModifier(modifier: 'ctrl' | 'alt'): void {
    if (modifier === 'ctrl') this.update({ pendingCtrl: !this.snapshot.pendingCtrl });
    else this.update({ pendingAlt: !this.snapshot.pendingAlt });
    this.focus();
  }

  sendKey(sequence: string): void {
    this.sendBytes(encoder.encode(sequence));
  }

  /** False when the browser refuses clipboard reads (plain http, or permission denied). */
  async paste(): Promise<boolean> {
    let text: string | undefined;
    try {
      text = await navigator.clipboard?.readText?.();
    } catch {
      return false;
    }
    if (text === undefined) return false;
    // terminal.paste applies bracketed paste, so a multi-line paste does not run line by line.
    if (text) this.terminal?.paste(text);
    return true;
  }

  /** Swallows only the copy and paste accelerators; plain Ctrl+C and Ctrl+V reach the shell. */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || !this.terminal) return true;
    const key = event.key.toLowerCase();
    const isMac = /mac|iphone|ipad/i.test(navigator.userAgent);
    const accel = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey;
    if (!accel) return true;
    if (key === 'c' && this.terminal.hasSelection()) {
      event.preventDefault();
      void copyTextToClipboard(this.terminal.getSelection());
      return false;
    }
    if (key === 'v') {
      event.preventDefault();
      void this.paste();
      return false;
    }
    return true;
  }

  // ── Display ────────────────────────────────────────────────────────────────

  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.terminal) this.terminal.options.theme = dark ? DARK_THEME : LIGHT_THEME;
  }

  clear(): void {
    this.terminal?.clear();
    this.focus();
  }

  /** Steps to the next or previous match; `incremental` re-runs from the current match as the query is typed. */
  search(query: string, direction: 'next' | 'prev', incremental = false): void {
    if (!this.searchAddon) return;
    if (!query) {
      this.clearSearch(true);
      return;
    }
    if (!this.snapshot.search) this.update({ search: { index: -1, count: 0 } });
    const options: ISearchOptions = { incremental, decorations: this.dark ? DARK_SEARCH : LIGHT_SEARCH };
    if (direction === 'next') this.searchAddon.findNext(query, options);
    else this.searchAddon.findPrevious(query, options);
  }

  /** `keepOpen` blanks the count while the search bar stays up. */
  clearSearch(keepOpen = false): void {
    this.searchAddon?.clearDecorations();
    this.terminal?.clearSelection();
    this.update({ search: keepOpen ? { index: -1, count: 0 } : null });
  }

  focus(): void {
    this.terminal?.focus();
  }

  private scheduleFit(): void {
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => this.fit(), FIT_DEBOUNCE_MS);
  }

  private fit(force = false): void {
    if (!this.terminal || !this.fitAddon || !this.element.isConnected) return;
    // A pane measured mid-reflow can be zero-sized; fitting to that leaves a blank screen.
    const proposed = this.fitAddon.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || proposed.cols < 2 || proposed.rows < 1) return;
    this.fitAddon.fit();
    this.mobileSelection?.updateHandles();
    const { cols, rows } = this.terminal;
    if (!force && cols === this.lastCols && rows === this.lastRows) return;
    this.lastCols = cols;
    this.lastRows = rows;
    this.send({ type: 'resize', cols, rows });
  }

  // ── Timers ─────────────────────────────────────────────────────────────────

  /** A half-open TCP connection looks open to both sides; two unanswered pings force a reconnect. */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.pingsAwaitingPong >= 2) {
        this.stopPing();
        this.dropSocket();
        this.scheduleReconnect();
        return;
      }
      this.pingsAwaitingPong += 1;
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pingsAwaitingPong = 0;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.reconnectTimer = null;
    this.connectTimer = null;
  }
}

/** xterm hands binary input back as a latin1 string; the wire wants those bytes. */
function latin1ToBytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) bytes[i] = data.charCodeAt(i) & 0xff;
  return bytes;
}
