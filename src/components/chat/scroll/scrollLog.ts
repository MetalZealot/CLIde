/**
 * Switchable record of every scroll-owner decision: `?clideScrollLog=1` turns it on for the origin,
 * `=0` turns it off. Entries carry mode, reason and positions, never message content; they collect
 * in `window.__clideScrollLog` and print with `console.debug`.
 */
const QUERY_PARAM = 'clideScrollLog';
const STORAGE_KEY = 'clide:scroll-log';
const MAX_ENTRIES = 500;

let enabled = false;
if (typeof window !== 'undefined') {
  const flag = new URLSearchParams(window.location.search).get(QUERY_PARAM);
  try {
    if (flag === '1') localStorage.setItem(STORAGE_KEY, '1');
    if (flag === '0') localStorage.removeItem(STORAGE_KEY);
    enabled = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    enabled = flag === '1';
  }
}

export function scrollLog(kind: 'mode' | 'write', detail: string): void {
  if (!enabled) return;
  const entry = `${Math.round(performance.now())}ms ${kind} ${detail}`;
  const buffer = ((window as unknown as { __clideScrollLog?: string[] }).__clideScrollLog ??= []);
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  console.debug('[scroll]', entry);
}
