import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useSessionStore } from '../../src/stores/useSessionStore';
import { historyBudgets } from './budgets';
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
  find = useChatFind({ isVisible: true, sessionId: session.id, sessionStore: store, loadedRecords: state.loadedRecords,
    renderedMessages: state.visibleMessages, jumpToMessage: state.jumpToMessage,
    scrollContainerRef: state.scrollContainerRef, messagesContentRef: state.messagesContentRef });
  useEffect(() => { document.title = `History fixture: ${session.id}`; }, [session.id]);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <ChatMessagesPane {...state} selectedProject={project} selectedSession={session}
      provider="claude"
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
    const initialIds = store.getSlot(fixture.id).serverMessages.map(message => message.id);
    const initialCursor = store.getSlot(fixture.id).nextCursor;
    const older = await measure(async () => {
      const old = state.chatMessages.length;
      state.scrollContainerRef.current!.scrollTop = 0;
      state.scrollContainerRef.current!.dispatchEvent(new Event('scroll'));
      await until(() => state.chatMessages.length > old && !state.isLoadingMoreMessages);
    });
    const loaded = store.getSlot(fixture.id);
    const loadedIds = loaded.serverMessages.map(message => message.id);
    const phase4Targets = {
      bookmarkAdvanced: Boolean(initialCursor && loaded.nextCursor && initialCursor !== loaded.nextCursor),
      noDuplicates: new Set(loadedIds).size === loadedIds.length,
      tailPreserved: JSON.stringify(loadedIds.slice(-initialIds.length)) === JSON.stringify(initialIds),
      usedBookmark: performance.getEntriesByType('resource').some(entry => entry.name.includes('before=')),
    };
    const searching = await measure(async () => {
      find.open();
      await pause(0);
      find.setQuery('Oldest unique needle');
      await until(() => !find.isPreparing && find.total > 0
        && state.visibleMessages.some((message) => String(message.content).startsWith('Oldest unique needle')));
    });
    const afterFind = snapshot();
    const findRequests = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname.endsWith('/messages'));
    find.close();
    await painted();
    // Back to the live conversation, as the reader's arrow button does, before live-message checks.
    state.scrollToBottomAndReset();
    await until(() => !state.isViewDetached && state.visibleMessages.at(-1)?.id === store.getMessages(fixture.id).at(-1)?.id);
    const phase6Targets = {
      boundedRows: afterFind.visible! <= historyBudgets.findMountedRows,
      noCompleteRead: findRequests.every((name) => /payload=text|around=/.test(name)),
    };
    const streaming = await measure(async () => {
      store.appendRealtime(fixture.id, { id: 'fixture-live-delta', sessionId: fixture.id, provider: 'claude',
        kind: 'text', role: 'assistant', content: 'A new live message.', timestamp: '2025-01-01T00:00:00Z' });
      await painted();
    });
    const refreshing = await measure(async () => {
      await store.refreshFromServer(fixture.id);
      await painted();
    });
    store.updateStreaming(fixture.id, 'Streaming first chunk.', 'claude');
    await painted();
    const streamingUpdate = await measure(async () => {
      store.updateStreaming(fixture.id, 'Streaming first chunk. Second chunk arrived.', 'claude');
      await painted();
      if (!document.body.textContent?.includes('Second chunk arrived.')) throw new Error('Streaming text did not update');
    });
    const phase3Targets = {
      append: streaming.conversions <= 1 && streaming.rows <= 3 && streaming.markdown <= 1,
      refresh: refreshing.conversions === 0 && refreshing.rows === 0 && refreshing.markdown === 0,
      streamUpdate: streamingUpdate.conversions <= 1 && streamingUpdate.rows <= 3 && streamingUpdate.markdown <= 1,
    };
    const result = { fixture, userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight],
      productionBundle: true, rowCountersInstrumented: true, initial, older, searching, afterFind, findRequests, streaming, refreshing, streamingUpdate, phase3Targets, phase4Targets, phase6Targets };
    const saved = await fetch('/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
    if (!saved.ok) throw new Error('Could not save benchmark result');
    if (Object.values(phase3Targets).some((passed) => !passed)) throw new Error('Phase 3 work-count target failed; see saved report');
    if (Object.values(phase4Targets).some(passed => !passed)) throw new Error('Phase 4 paging target failed; see saved report');
    if (Object.values(phase6Targets).some(passed => !passed)) throw new Error('Phase 6 Find target failed; see saved report');
    return result;
  },
};
