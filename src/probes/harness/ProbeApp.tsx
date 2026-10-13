import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import {
  APPEARANCE_STORAGE_KEY,
  parseAppearancePreferences,
} from '../../contexts/AppearancePreferencesContext';

import ProbeFrame from './ProbeFrame';
import { PROBES, findProbe, type RegisteredProbe } from './registry';
import type { ProbeDefinition } from './types';

type Theme = 'light' | 'dark';
type ProbeState = { selection: Record<string, string>; theme: Theme };

const MESSAGE_TYPE = 'clide-probe-state';
// At or above this width the frame is drawn phone-sized in an iframe, so its
// breakpoints and `isMobile` see a phone viewport.
const DESKTOP_MIN_WIDTH = 768;
const PHONE_WIDTH = 360;
const PHONE_HEIGHT = 800;

const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get('embed') === '1';

/** Reads the saved appearance without writing it: a probe never changes the app's settings. */
function applyStoredAppearance(): Theme {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null');
  } catch {
    stored = null;
  }
  const preferences = parseAppearancePreferences(stored);
  const root = document.documentElement;
  root.dataset.chatReadingSize = preferences.chatReadingSize;
  root.dataset.chatLineSpacing = preferences.chatLineSpacing;
  root.dataset.fontFamily = preferences.fontFamily;
  if (preferences.theme === 'light' || preferences.theme === 'dark') return preferences.theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141414' : '#f6f4ef');
}

function initialState(probe: ProbeDefinition): ProbeState {
  const fallbackTheme = applyStoredAppearance();
  const selection: Record<string, string> = {};
  for (const [key, axis] of Object.entries(probe.axes)) {
    const fromUrl = params.get(key);
    selection[key] = fromUrl && fromUrl in axis.options ? fromUrl : Object.keys(axis.options)[0];
  }
  const urlTheme = params.get('theme');
  return { selection, theme: urlTheme === 'light' || urlTheme === 'dark' ? urlTheme : fallbackTheme };
}

function stateUrl(state: ProbeState, extra?: Record<string, string>): string {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(state.selection)) url.searchParams.set(key, value);
  url.searchParams.set('theme', state.theme);
  for (const [key, value] of Object.entries(extra ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        'h-8 min-w-10 rounded-lg border px-2.5 text-[13px]',
        pressed ? 'border-primary text-primary' : 'border-border',
      )}
    >
      {children}
    </button>
  );
}

function ProbeControls({ entry, state, onChange }: {
  entry: RegisteredProbe;
  state: ProbeState;
  onChange: (next: ProbeState) => void;
}) {
  const { probe } = entry;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="font-semibold">{probe.title}</div>
        <div className="text-muted-foreground">{probe.question}</div>
      </div>
      {Object.entries(probe.axes).map(([key, axis]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{axis.label}</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(axis.options).map(([value, option]) => (
              <Choice
                key={value}
                pressed={state.selection[key] === value}
                onClick={() => onChange({ ...state, selection: { ...state.selection, [key]: value } })}
              >
                {value.length === 1 ? `${value} ${option.label}` : option.label}
              </Choice>
            ))}
          </div>
          <p className="text-muted-foreground">{axis.options[state.selection[key]]?.meaning}</p>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex gap-1">
          {(['dark', 'light'] as const).map((theme) => (
            <Choice key={theme} pressed={state.theme === theme} onClick={() => onChange({ ...state, theme })}>
              {theme === 'dark' ? 'Dark' : 'Light'}
            </Choice>
          ))}
        </div>
        <a href="?" target="_top" className="text-primary underline">All probes</a>
      </div>
    </div>
  );
}

/** Phone: a tab on the left edge opens the controls over the frame, with no scrim. */
function PhoneControls(props: Parameters<typeof ProbeControls>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Probe options"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="fixed left-0 top-1/2 z-50 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg bg-foreground/80 text-background shadow-lg"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[45dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 text-card-foreground shadow-2xl">
          <button
            type="button"
            aria-label="Close probe options"
            onClick={() => setOpen(false)}
            className="float-right -mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <ProbeControls {...props} />
        </div>
      )}
    </>
  );
}

function ProbeView({ entry }: { entry: RegisteredProbe }) {
  const [state, setState] = useState(() => initialState(entry.probe));
  const [isDesktop] = useState(() => !isEmbedded && window.innerWidth >= DESKTOP_MIN_WIDTH);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameSrc] = useState(() => stateUrl(state, { embed: '1' }));

  useEffect(() => {
    applyTheme(state.theme);
    if (!isEmbedded) window.history.replaceState(null, '', stateUrl(state));
    frameRef.current?.contentWindow?.postMessage({ type: MESSAGE_TYPE, state }, window.location.origin);
  }, [state]);

  useEffect(() => {
    if (!isEmbedded) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === MESSAGE_TYPE) setState(event.data.state);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const postOnLoad = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: MESSAGE_TYPE, state }, window.location.origin);
  }, [state]);

  if (isDesktop) {
    return (
      <div className="flex min-h-dvh items-start justify-center gap-8 bg-muted/40 p-8 text-foreground">
        <iframe
          ref={frameRef}
          title={entry.probe.title}
          src={frameSrc}
          onLoad={postOnLoad}
          width={PHONE_WIDTH}
          height={PHONE_HEIGHT}
          className="flex-none rounded-2xl border border-border bg-background shadow-xl"
        />
        <div className="w-80 rounded-xl border border-border bg-card p-4 text-card-foreground">
          <ProbeControls entry={entry} state={state} onChange={setState} />
        </div>
      </div>
    );
  }

  return (
    <>
      <ProbeFrame options={entry.probe.frame}>{entry.probe.render(state.selection)}</ProbeFrame>
      {!isEmbedded && <PhoneControls entry={entry} state={state} onChange={setState} />}
    </>
  );
}

function ProbeIndex({ missing }: { missing?: string | null }) {
  useEffect(() => applyTheme(applyStoredAppearance()), []);
  return (
    <div className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-lg font-semibold">Probes</h1>
        {missing && <p className="text-sm text-destructive">No probe named “{missing}” in this checkout.</p>}
        {PROBES.length === 0 && <p className="text-sm text-muted-foreground">No probes in this checkout.</p>}
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {PROBES.map(({ name, probe }) => (
            <li key={name}>
              <a href={`?p=${encodeURIComponent(name)}`} className="flex flex-col gap-0.5 px-4 py-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{probe.title}</span>
                  <span className="flex-none text-xs tabular-nums text-muted-foreground">{probe.date}</span>
                </span>
                <span className="text-sm text-muted-foreground">{probe.question}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ProbeApp() {
  const name = params.get('p');
  const entry = findProbe(name);
  return entry ? <ProbeView entry={entry} /> : <ProbeIndex missing={name} />;
}
