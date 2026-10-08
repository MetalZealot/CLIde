/**
 * Opt-in chat-path flight recorder: for every frame reaching the client, its
 * kind, ids and what the handlers did with it — never contents. It separates
 * "never arrived" from "arrived and threw" from "the store dropped it" on a
 * device nobody can drive. `?clideRecord=1` turns it on for the origin, `=0`
 * turns it off and deletes what it kept.
 *
 * Each page load writes only its own storage key, so two open tabs never
 * overwrite each other's events.
 */

import { copyTextToClipboard } from './clipboard';

export const RECORDER_QUERY_PARAM = 'clideRecord';
const ENABLED_KEY = 'clide:flight-recorder:on';
const BOOT_KEY_PREFIX = 'clide:flight-recorder:v1:';
const MAX_EVENTS_PER_BOOT = 300;
const MAX_BOOTS = 3;
const REPORT_MAX_LINES = 250;
const FLUSH_DELAY_MS = 1000;

/** What a handler did with a frame. Set by code, so a report never carries data. */
export type FrameNote =
  | 'dup' // replay overlap, already dispatched
  | 'stale-socket' // arrived on a socket the client had replaced
  | 'unparsed'
  | 'no-session' // nothing to file the row under
  | 'subagent' // subagent prose, not rendered live
  | 'empty-delta'
  | 'buffered' // stream text held for the 100 ms flush
  | 'stream-gap' // a delta after one this client missed; the block's final row fills it
  | 'stored' // appended to the session store
  | 'no-id' // stored without a row id
  | 'cap' // storing it evicted the oldest live row
  | 'detached' // stored while the view shows an older window
  | 'hidden' // stored, but the merged view does not contain it
  | 'threw';

export type FlightEventName =
  | 'frame'
  | 'send'
  | 'ws.connect'
  | 'ws.no-url'
  | 'ws.open'
  | 'ws.close'
  | 'ws.error'
  | 'ws.watchdog'
  | 'ws.wake'
  | 'page.hidden'
  | 'page.visible';

export type FlightEvent = {
  at: number;
  name: FlightEventName;
  kind?: string;
  sessionId?: string;
  runId?: string;
  seq?: number;
  lastSeq?: number;
  count?: number;
  listeners?: number;
  notes?: FrameNote[];
  error?: string;
  /** Close code for `ws.close`, readyState for `ws.wake`. */
  code?: number;
  sent?: boolean;
};

type BootRecord = {
  v: 1;
  boot: string;
  startedAt: number;
  env: string;
  events: FlightEvent[];
};

type FrameFields = Pick<FlightEvent, 'kind' | 'sessionId' | 'runId' | 'seq'>;

const ID_CHARS = /[^\w-]/g;
const shortId = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value.replace(ID_CHARS, '').slice(0, 8) || undefined : undefined;

const safeKind = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[\w.:-]{1,40}$/.test(value) ? value : value === undefined ? undefined : '?';

/** Fields a frame contributes: identifiers only, whatever else it carries. */
export const frameFields = (frame: unknown): FrameFields => {
  if (!frame || typeof frame !== 'object') return {};
  const record = frame as Record<string, unknown>;
  const subscribed = Array.isArray(record.sessions) ? record.sessions[0] as Record<string, unknown> | undefined : undefined;
  return {
    kind: safeKind(record.kind ?? record.type),
    sessionId: shortId(record.sessionId ?? subscribed?.sessionId),
    runId: shortId(record.runId),
    seq: typeof record.seq === 'number' && Number.isFinite(record.seq) ? record.seq : undefined,
  };
};

/**
 * An error as one line plus its top stack frames. Quoted text longer than an
 * identifier is elided and query strings are cut, since either can hold content
 * or a token.
 */
export const redactError = (error: unknown): string => {
  const scrub = (text: string) => text
    .replace(/(["'`])([^"'`\n]{0,400})\1/g, (match, quote: string, inner: string) =>
      /^[\w$.-]{0,40}$/.test(inner) ? match : `${quote}…${quote}`)
    .replace(/\?[^\s):#]*/g, '')
    .replace(/https?:\/\/[^/\s)]+/g, '');
  if (!(error instanceof Error)) return scrub(String(error)).slice(0, 160);
  const head = scrub(`${error.name}: ${error.message}`).slice(0, 160);
  const frames = (error.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at |@/.test(line))
    .slice(0, 4)
    .map((line) => scrub(line).slice(0, 120));
  return [head, ...frames].join(' | ');
};

const sameFrame = (a: FlightEvent, b: FlightEvent) =>
  a.name === 'frame' && b.name === 'frame'
  && !a.error && !b.error
  && a.kind === b.kind && a.sessionId === b.sessionId && a.runId === b.runId
  && a.listeners === b.listeners
  && (a.notes ?? []).join() === (b.notes ?? []).join();

const randomBootId = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

const describeEnvironment = (): string => {
  if (typeof window === 'undefined') return 'unknown';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = ['SamsungBrowser', 'Edg', 'Firefox', 'Chrome', 'Version']
    .map((name) => ua.match(new RegExp(`${name}/[\\d.]+`))?.[0])
    .find(Boolean)?.replace('Version', 'Safari') ?? 'browser?';
  const os = ua.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+|Linux/)?.[0] ?? 'os?';
  const standalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  const script = typeof document !== 'undefined'
    ? document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src.split('/').pop() ?? 'dev'
    : 'dev';
  const route = window.location.pathname.startsWith('/session/') ? '/session/:id' : window.location.pathname;
  return `${browser} · ${os} · ${standalone ? 'installed' : 'tab'} · ${script} · ${route}`;
};

const formatTime = (at: number) => new Date(at).toISOString().slice(11, 23);

const formatEvent = (event: FlightEvent, previousListeners: number | undefined): string => {
  const parts = [formatTime(event.at), event.name];
  if (event.kind) parts.push(event.kind);
  if (event.sessionId) parts.push(`s=${event.sessionId}`);
  if (event.runId) parts.push(`run=${event.runId}`);
  if (event.count && event.count > 1) parts.push(`×${event.count}`);
  if (event.seq !== undefined) {
    parts.push(event.lastSeq !== undefined && event.lastSeq !== event.seq
      ? `seq=${event.seq}–${event.lastSeq}`
      : `seq=${event.seq}`);
  }
  if (event.code !== undefined) parts.push(`code=${event.code}`);
  if (event.listeners !== undefined && event.listeners !== previousListeners) {
    parts.push(`listeners=${event.listeners}`);
  }
  if (event.sent !== undefined) parts.push(event.sent ? 'sent' : 'NOT SENT');
  if (event.notes?.length) parts.push(event.notes.join(','));
  if (event.error) parts.push(`— ${event.error}`);
  return parts.join(' ');
};

export type FlightRecorderDeps = {
  storage: Storage;
  now?: () => number;
  bootId?: string;
  environment?: string;
};

/** One page load's recorder. The app uses the module singleton below. */
export const createFlightRecorder = ({
  storage,
  now = Date.now,
  bootId = randomBootId(),
  environment = describeEnvironment(),
}: FlightRecorderDeps) => {
  const record: BootRecord = { v: 1, boot: bootId, startedAt: now(), env: environment, events: [] };
  let current: FlightEvent | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let writable = true;

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!writable) return;
    try {
      storage.setItem(BOOT_KEY_PREFIX + bootId, JSON.stringify(record));
    } catch {
      writable = false; // quota or private mode: keep recording in memory only
    }
  };

  const scheduleFlush = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  };

  const append = (event: FlightEvent) => {
    record.events.push(event);
    if (record.events.length > MAX_EVENTS_PER_BOOT) record.events.shift();
    scheduleFlush();
  };

  /** Folds `event` into the line before it when they differ only in seq. */
  const collapseInto = (previous: FlightEvent | undefined, event: FlightEvent) => {
    if (!previous || previous === current || !sameFrame(previous, event)) return false;
    previous.count = (previous.count ?? 1) + 1;
    if (event.seq !== undefined) previous.lastSeq = event.seq;
    scheduleFlush();
    return true;
  };

  const push = (event: FlightEvent) => {
    if (!collapseInto(record.events.at(-1), event)) append(event);
  };

  const prune = () => {
    const boots: Array<{ key: string; startedAt: number }> = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(BOOT_KEY_PREFIX) || key === BOOT_KEY_PREFIX + bootId) continue;
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? '') as BootRecord;
        if (parsed?.v === 1 && Array.isArray(parsed.events) && typeof parsed.startedAt === 'number') {
          boots.push({ key, startedAt: parsed.startedAt });
          continue;
        }
      } catch {
        // falls through to removal
      }
      boots.push({ key, startedAt: -1 });
    }
    boots.sort((a, b) => b.startedAt - a.startedAt);
    boots.forEach(({ key, startedAt }, index) => {
      if (startedAt < 0 || index >= MAX_BOOTS - 1) storage.removeItem(key);
    });
  };

  const readBoots = (): BootRecord[] => {
    const boots: BootRecord[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(BOOT_KEY_PREFIX) || key === BOOT_KEY_PREFIX + bootId) continue;
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? '') as BootRecord;
        if (parsed?.v === 1 && Array.isArray(parsed.events)) boots.push(parsed);
      } catch {
        // a corrupt record is left for the next prune
      }
    }
    return [...boots, record].sort((a, b) => a.startedAt - b.startedAt);
  };

  return {
    prune,
    flush,

    /** Stops writing, so a pending flush cannot restore what Off deleted. */
    dispose() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      writable = false;
      current = null;
    },

    /** Logged before dispatch, so anything a handler sends lands after it. */
    beginFrame(frame: unknown, listeners: number): FlightEvent {
      const event: FlightEvent = { at: now(), name: 'frame', ...frameFields(frame), listeners };
      append(event);
      current = event;
      return event;
    },

    endFrame(event: FlightEvent) {
      if (current === event) current = null;
      const { events } = record;
      if (events.at(-1) === event && collapseInto(events.at(-2), event)) events.pop();
    },

    /** A frame no handler saw: a duplicate, a stale socket, or unparseable text. */
    dropFrame(frame: unknown, note: FrameNote) {
      push({ at: now(), name: 'frame', ...frameFields(frame), notes: [note] });
    },

    /** Annotates the frame being dispatched; a no-op outside dispatch. */
    note(note: FrameNote) {
      if (!current) return;
      const notes = current.notes ?? (current.notes = []);
      if (!notes.includes(note)) notes.push(note);
    },

    noteError(error: unknown) {
      if (!current) return;
      const notes = current.notes ?? (current.notes = []);
      if (!notes.includes('threw')) notes.push('threw');
      current.error ??= redactError(error);
    },

    event(name: FlightEventName, fields: Partial<Pick<FlightEvent, 'code' | 'sent' | 'kind' | 'sessionId'>> = {}) {
      push({ at: now(), name, ...fields });
    },

    send(message: unknown, sent: boolean) {
      const { kind, sessionId } = frameFields(message);
      push({ at: now(), name: 'send', kind, sessionId, sent });
    },

    clear() {
      record.events = [];
      for (const { boot } of readBoots()) storage.removeItem(BOOT_KEY_PREFIX + boot);
      flush();
    },

    /** One pasteable block: newest lines last, older ones counted, never contents. */
    report(): string {
      const boots = readBoots();
      const lines: string[] = [];
      boots.forEach((boot, index) => {
        lines.push(`— load ${index + 1} of ${boots.length}: ${new Date(boot.startedAt).toISOString()} · ${boot.env}`);
        let listeners: number | undefined;
        for (const event of boot.events) {
          lines.push(formatEvent(event, listeners));
          if (event.listeners !== undefined) listeners = event.listeners;
        }
      });
      const omitted = Math.max(0, lines.length - REPORT_MAX_LINES);
      return [
        `CLIde flight recorder v1 · copied ${new Date(now()).toISOString()} · times UTC`,
        'Kinds, ids and handler outcomes only; no message text.',
        ...(omitted ? [`(${omitted} older lines omitted)`] : []),
        ...lines.slice(omitted),
      ].join('\n');
    },
  };
};

export type FlightRecorder = ReturnType<typeof createFlightRecorder>;

let recorder: FlightRecorder | null = null;
let controls: HTMLElement | null = null;

const localStorageOrNull = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Null while off — every call site is one property check when disabled. */
export const flightRecorder = (): FlightRecorder | null => recorder;

const removeStoredBoots = (storage: Storage) => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(BOOT_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
};

export const stopFlightRecorder = () => {
  const storage = localStorageOrNull();
  recorder?.dispose();
  recorder = null;
  controls?.remove();
  controls = null;
  if (!storage) return;
  storage.removeItem(ENABLED_KEY);
  removeStoredBoots(storage);
};

const mountControls = (active: FlightRecorder) => {
  if (typeof document === 'undefined' || !document.body || controls) return;
  const bar = document.createElement('div');
  bar.setAttribute('data-flight-recorder', '');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Flight recorder');
  Object.assign(bar.style, {
    position: 'fixed',
    // Below a typical header and clear of its title; covers only scrolling chat.
    top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
    right: '8px',
    whiteSpace: 'nowrap',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '2px',
    borderRadius: '999px',
    background: 'rgba(20, 20, 20, 0.9)',
    color: '#fff',
    font: '600 12px/1 system-ui, sans-serif',
  });

  const label = document.createElement('span');
  label.textContent = '● Rec';
  Object.assign(label.style, { color: '#f87171', padding: '0 6px 0 8px' });

  const button = (text: string, onClick: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    Object.assign(element.style, {
      minHeight: '28px',
      padding: '0 10px',
      border: '0',
      borderRadius: '999px',
      background: 'rgba(255, 255, 255, 0.12)',
      color: 'inherit',
      font: 'inherit',
    });
    element.addEventListener('click', onClick);
    return element;
  };

  const flash = (element: HTMLButtonElement, text: string) => {
    const original = element.textContent;
    element.textContent = text;
    setTimeout(() => { element.textContent = original; }, 2000);
  };

  const showForManualCopy = (text: string) => {
    const area = document.createElement('textarea');
    area.readOnly = true;
    area.value = text;
    Object.assign(area.style, {
      position: 'fixed', inset: '40px 8px 8px', zIndex: '2147483647',
      font: '11px/1.4 ui-monospace, monospace', background: '#141414', color: '#eee',
    });
    area.addEventListener('blur', () => area.remove());
    document.body.appendChild(area);
    area.focus();
    area.select();
  };

  const copy = button('Copy', () => {
    active.flush();
    const text = active.report();
    void copyTextToClipboard(text).then((copied) => {
      if (copied) flash(copy, 'Copied');
      else showForManualCopy(text);
    });
  });
  const clear = button('Clear', () => {
    active.clear();
    flash(clear, 'Cleared');
  });
  const off = button('Off', () => stopFlightRecorder());

  bar.append(label, copy, clear, off);
  document.body.appendChild(bar);
  controls = bar;
};

/**
 * Reads the query switch and, when on, starts recording for this page load.
 * Called once from `main` before React renders; repeat calls are no-ops.
 */
export const startFlightRecorder = () => {
  if (recorder || typeof window === 'undefined') return;
  const storage = localStorageOrNull();
  if (!storage) return;

  const url = new URL(window.location.href);
  const requested = url.searchParams.get(RECORDER_QUERY_PARAM);
  if (requested !== null) {
    url.searchParams.delete(RECORDER_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
    if (requested === '1') storage.setItem(ENABLED_KEY, '1');
    else stopFlightRecorder();
  }
  if (storage.getItem(ENABLED_KEY) !== '1') return;

  const active = createFlightRecorder({ storage });
  active.prune();
  active.flush();
  recorder = active;

  document.addEventListener('visibilitychange', () => {
    if (recorder !== active) return;
    active.event(document.visibilityState === 'hidden' ? 'page.hidden' : 'page.visible');
    if (document.visibilityState === 'hidden') active.flush();
  });
  window.addEventListener('pagehide', () => {
    if (recorder === active) active.flush();
  });
  mountControls(active);
};
