import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useSessionStore } from '../../src/stores/useSessionStore';
import { useChatSessionState } from '../../src/components/chat/hooks/useChatSessionState';
import { useChatFind } from '../../src/components/chat/hooks/useChatFind';
import ChatMessagesPane from '../../src/components/chat/view/subcomponents/ChatMessagesPane';
import { AppearancePreferencesProvider } from '../../src/contexts/AppearancePreferencesContext';
import enChat from '../../src/i18n/locales/en/chat.json';
import enCommon from '../../src/i18n/locales/en/common.json';
import '../../src/index.css';

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { chat: enChat, common: enCommon } }, interpolation: { escapeValue: false } });
const fixtures: Array<{ id: string; count: number }> = await fetch('/fixtures').then((r) => r.json());
const project = { projectId: 'fixture-project', displayName: 'Synthetic history', path: '/fixture', fullPath: '/fixture' };
const noop = () => undefined;
const grant = () => ({ success: false });
const send = () => true;
const replay = () => null;
const counters = () => (globalThis as any).__historyCounters ??= { rows: 0, markdown: 0, conversions: 0 };
const frames: number[] = [];
const longTasks: number[] = [];
let measuring = false;
let previousFrame = 0;
const tick = (now: number) => {
  if (measuring && previousFrame) frames.push(now - previousFrame);
  previousFrame = now;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver((list) => { if (measuring) longTasks.push(...list.getEntries().map((e) => e.duration)); })
    .observe({ type: 'longtask', buffered: false });
}
let state: ReturnType<typeof useChatSessionState>;
let find: ReturnType<typeof useChatFind>;
let store: ReturnType<typeof useSessionStore>;
let selectedId = fixtures[0].id;
function Harness() {
  store = useSessionStore();
  const [session] = useState({ id: selectedId, __provider: 'claude' as const });
  const status = useRef(new Map<string, number>());
  state = useChatSessionState({ selectedProject: project, selectedSession: session, ws: null,
    sendMessage: send, resetStreamingState: noop, statusCheckSentAtRef: status,
    getReplayProgress: replay, sessionStore: store });
  find = useChatFind({ isVisible: true, sessionId: session.id, chatMessages: state.chatMessages,
    loadAllMessages: state.loadAllMessages, scrollContainerRef: state.scrollContainerRef,
    messagesContentRef: state.messagesContentRef });
  useEffect(() => { document.title = `History fixture: ${session.id}`; }, [session.id]);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <ChatMessagesPane {...state} selectedProject={project} selectedSession={session}
      provider="claude" tasksEnabled={false} isTaskMasterInstalled={false} setInput={noop}
      onGrantToolPermission={grant} showThinking={false} scheduledMessages={[]}
      onSendScheduledNow={noop} onEditScheduledMessage={noop} onCancelScheduledMessage={noop}
      onResumeScheduledMessage={noop} />
  </div>;
}
const root = createRoot(document.getElementById('root')!);
let ran = false;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const painted = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
const until = async (predicate: () => boolean) => {
  const end = performance.now() + 30_000;
  while (!predicate()) { if (performance.now() > end) throw new Error('Fixture operation timed out'); await pause(20); }
  await painted();
};
const snapshot = () => ({ sessionId: selectedId, mountedRows: document.querySelectorAll('.chat-message').length,
  messages: state?.chatMessages.length, visible: state?.visibleMessages.length, matches: find?.total,
  heapEstimateBytes: (performance as any).memory?.usedJSHeapSize ?? null, ...counters() });
const measure = async (operation: () => Promise<void>) => {
  counters().rows = 0; counters().markdown = 0; counters().conversions = 0;
  frames.length = 0; longTasks.length = 0;
  performance.clearResourceTimings();
  const beforeHeap = (performance as any).memory?.usedJSHeapSize ?? null;
  measuring = true; previousFrame = 0;
  const start = performance.now();
  try {
    await operation();
    const elapsedMs = performance.now() - start;
    await pause(100); // Deliver observer records after the last paint.
    const sorted = [...frames].sort((a, b) => a - b);
    const http = performance.getEntriesByType('resource').filter((r) => r.name.includes('/messages')) as PerformanceResourceTiming[];
    return { ...snapshot(), elapsedMs, frameP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      maxLongTaskMs: Math.max(0, ...longTasks), frameSamples: frames.length,
      longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
      heapEstimateDeltaBytes: beforeHeap === null ? null : (performance as any).memory.usedJSHeapSize - beforeHeap,
      historyRequests: http.length, historyBodyBytes: http.reduce((sum, r) => sum + r.decodedBodySize, 0),
      historyRequestMs: http.map((r) => r.duration) };
  } finally { measuring = false; }
};
(window as any).historyBench = {
  fixtures, snapshot,
  async run(index: number) {
    const fixture = fixtures[index];
    if (!fixture) throw new Error('Unknown fixture');
    if (ran) throw new Error('Reload the fixture page before each sample');
    ran = true;
    selectedId = fixture.id;
    const initial = await measure(async () => {
      root.render(<AppearancePreferencesProvider><Harness /></AppearancePreferencesProvider>);
      await until(() => !!state && state.currentSessionId === fixture.id && !state.isLoadingSessionMessages && state.chatMessages.length > 0);
    });
    const older = await measure(async () => {
      const old = state.chatMessages.length;
      state.scrollContainerRef.current!.scrollTop = 0;
      state.scrollContainerRef.current!.dispatchEvent(new Event('scroll'));
      await until(() => state.chatMessages.length > old && !state.isLoadingMoreMessages);
    });
    const searching = await measure(async () => {
      find.open();
      await pause(0);
      find.setQuery('Oldest unique needle');
      await until(() => !find.isPreparing && find.total > 0);
    });
    const afterFind = snapshot();
    find.close();
    await painted();
    const streaming = await measure(async () => {
      store.appendRealtime(fixture.id, { id: 'fixture-live-delta', sessionId: fixture.id, provider: 'claude',
        kind: 'text', role: 'assistant', content: 'A new live message.', timestamp: '2025-01-01T00:00:00Z' });
      await painted();
    });
    const result = { fixture, userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight],
      productionBundle: true, rowCountersInstrumented: true, initial, older, searching, afterFind, streaming };
    const saved = await fetch('/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
    if (!saved.ok) throw new Error('Could not save benchmark result');
    return result;
  },
};
