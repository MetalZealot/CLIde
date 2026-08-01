import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LIFECYCLE_DIAGNOSTIC_EVENT,
  clearLifecycleDiagnostics,
  getLifecycleBootId,
  getLifecycleDiagnostics,
  getResumeProbeMode,
  isLifecycleDiagnosticsEnabled,
} from '../../utils/lifecycleDiagnostics';

export default function LifecycleDiagnosticsPanel() {
  const enabled = isLifecycleDiagnosticsEnabled();
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [events, setEvents] = useState(() => getLifecycleDiagnostics());

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => setEvents(getLifecycleDiagnostics());
    window.addEventListener(LIFECYCLE_DIAGNOSTIC_EVENT, refresh);
    return () => window.removeEventListener(LIFECYCLE_DIAGNOSTIC_EVENT, refresh);
  }, [enabled]);

  const exportText = useMemo(() => JSON.stringify({
    bootId: getLifecycleBootId(),
    resumeProbes: getResumeProbeMode(),
    events,
  }, null, 2), [events]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = exportText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command failed');
      }
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [exportText]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-3 left-3 z-[10000] font-mono text-xs">
      {isOpen && (
        <div className="mb-2 flex h-[min(60vh,32rem)] w-[min(92vw,32rem)] flex-col overflow-hidden rounded-md border border-border bg-background text-foreground shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate">
              Boot {getLifecycleBootId().slice(0, 8)} · probes {getResumeProbeMode()}
            </span>
            <button className="rounded border border-border px-2 py-1" type="button" onClick={() => void copy()}>
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
            </button>
            <button
              className="rounded border border-border px-2 py-1"
              type="button"
              onClick={() => {
                clearLifecycleDiagnostics();
                setEvents([]);
              }}
            >
              Clear
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-[10px] leading-4">
            {events.slice(-100).map((event) => (
              <span key={`${event.sequence}-${event.timestamp}`} className="block">
                {event.sequence} +{event.elapsedMs}ms {event.bootId.slice(0, 8)} {event.name}{' '}
                {event.details ? JSON.stringify(event.details) : ''}
              </span>
            ))}
          </pre>
        </div>
      )}
      <button
        className="rounded-full border border-border bg-background px-3 py-2 text-foreground shadow-lg"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        Diag {getLifecycleBootId().slice(0, 4)}
      </button>
    </div>
  );
}
