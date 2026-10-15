/**
 * Browser scenarios for the chat scroll rules (docs/designs/chat-history-performance.md).
 * Each drives the real chat view in the harness shell and checks one rule; the runner
 * (`run-scenarios.mjs`) runs each in a fresh page, in the phone page layout and the desktop pane.
 */
import { historyBudgets } from './budgets';

export type ScenarioMode = 'pane' | 'page';
export type ScenarioResult = { checks: Record<string, boolean>; data: Record<string, unknown> };

export interface ScenarioContext {
  /** Renders the fixture in `mode` and resolves once its first page shows. */
  /** `lateReflowMs`: re-wraps every message that long after the first pin to the bottom, as a late web font does. */
  mount(fixtureId: string, mode: ScenarioMode, options: { activity: boolean; lateReflowMs?: number }): Promise<void>;
  host(): HTMLElement;
  /** True while the chat follows the bottom: the jump button is hidden. */
  following(): boolean;
  isLoading(): boolean;
  streamReply(text: string): void;
  refresh(): Promise<void>;
  /** Opens Find with `query`; resolves once its matches are counted. */
  find(query: string): Promise<number>;
  closeFind(): void;
  returnToLatest(): void;
  /** Words from an early user prompt in the whole transcript, likely outside the loaded pages. */
  earlyPromptSnippet(): Promise<string | null>;
  /** A finished tool call arriving live at the end, as an agent's command does. */
  appendToolRow(): void;
  /** Resizes the browser viewport; provided by the runner. */
  resize(width: number, height: number): Promise<void>;
}

const nextFrame = () => new Promise<number>(requestAnimationFrame);
/** Resolves after the next frame has painted: what the reader saw. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
}));
const frames = async (count: number) => { for (let i = 0; i < count; i += 1) await afterPaint(); };

/** Measured 2026-10-14: the bottom pin ran while fonts loaded; the prose font landed one restore later. */
const LATE_FONT_MS = 100;

let shiftSum = 0;
if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
      if (!entry.hadRecentInput) shiftSum += entry.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
}

export function createScenarios(ctx: ScenarioContext) {
  const distance = () => { const el = ctx.host(); return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight); };
  const pageMode = () => ctx.host() === document.documentElement;
  /** The band where messages are readable: the pane, or the page between its sticky bars. */
  const band = () => {
    if (!pageMode()) { const rect = ctx.host().getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }
    return {
      top: document.querySelector('[data-chat-page-top]')?.getBoundingClientRect().bottom ?? 0,
      bottom: document.querySelector('[data-chat-page-bottom]')?.getBoundingClientRect().top ?? innerHeight,
    };
  };
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.chat-rows > .chat-message'));
  /** The row the reader is on and the edge rule 4 holds: its top, or its bottom once the top is off screen. */
  const held = () => {
    const { top, bottom } = band();
    const row = rows().find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.bottom > top && rect.top < bottom;
    });
    if (!row) throw new Error('No row in the readable band');
    const edge: 'top' | 'bottom' = row.getBoundingClientRect().top >= top ? 'top' : 'bottom';
    const at = () => row.getBoundingClientRect()[edge] - band().top;
    const start = at();
    return { row, edge, moved: () => Math.round(row.isConnected ? at() - start : Number.NaN) };
  };
  /** Waits until nothing loads and the scroll geometry holds for 20 painted frames. */
  const settled = async () => {
    const end = performance.now() + 30_000;
    let still = 0, last = '';
    while (still < 20) {
      if (performance.now() > end) throw new Error('History did not settle');
      await afterPaint();
      const el = ctx.host();
      const now = `${el.scrollTop}/${el.scrollHeight}/${el.clientHeight}`;
      still = now === last && !ctx.isLoading() ? still + 1 : 0;
      last = now;
    }
  };
  /** A reader's own scroll: input first, then the movement, as a wheel or swipe delivers it. */
  const readerScroll = async (dy: number) => {
    const el = ctx.host();
    (pageMode() ? window : el).dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    el.scrollTop += dy;
    await frames(2);
  };
  const toMiddle = async () => {
    const el = ctx.host();
    let guard = 0;
    while (el.scrollTop > el.scrollHeight / 2 - el.clientHeight && guard < 200) { await readerScroll(-400); guard += 1; }
    await settled();
  };
  /** Records the largest movement of `watch` across painted frames while `step` runs until it returns true. */
  const during = async (watch: () => number, step: (frame: number) => boolean | Promise<boolean>) => {
    let worst = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      const done = await step(frame);
      await afterPaint();
      const value = Math.abs(watch());
      if (!Number.isNaN(value)) worst = Math.max(worst, value);
      if (done) return worst;
    }
    throw new Error('Scenario step did not finish');
  };
  const streamFor = (frameCount: number) => {
    let words = '';
    return (frame: number) => {
      if (frame % 2 === 0) { words += ` Streamed sentence ${frame} with enough words to wrap the line at phone width.`; ctx.streamReply(words); }
      return frame >= frameCount;
    };
  };
  /** Opens at the bottom; when opening itself went wrong (the `open` scenario's fault), starts clean from the jump button. */
  const open = async (fixtureId: string, mode: ScenarioMode) => {
    await ctx.mount(fixtureId, mode, { activity: true, lateReflowMs: LATE_FONT_MS });
    await settled();
    await frames(60);
    const clean = near(distance()) && ctx.following();
    if (!clean) { ctx.returnToLatest(); await settled(); }
    shiftSum = 0;
    return { openedClean: clean };
  };
  const near = (px: number) => px <= historyBudgets.walkJumpPx;
  /** A closed tool card whose top sits in the given slice of the readable band. */
  const toggleIn = (from: number, to: number) => {
    const { top, bottom } = band();
    const height = bottom - top;
    return rows().filter((row) => row.classList.contains('tool')).map((row) => ({ row, button: row.querySelector<HTMLButtonElement>('button[aria-expanded="false"]') }))
      .reverse().find(({ row, button }) => {
        const rect = row.getBoundingClientRect();
        return button && rect.top > top + height * from && rect.top < top + height * to;
      });
  };

  const scenarios: Record<string, (fixtureId: string, mode: ScenarioMode) => Promise<ScenarioResult>> = {
    /** Not a rule: what the rendered rows look like, for writing scenarios. */
    async inspect(fixtureId, mode) {
      await open(fixtureId, mode);
      const summary = rows().map((row) => `${row.className.replace('chat-message', '').trim().slice(0, 40)} h=${Math.round(row.getBoundingClientRect().height)} toggles=${row.querySelectorAll('button[aria-expanded]').length}`);
      return { checks: {}, data: { rows: summary.slice(-25), expandButtons: document.querySelectorAll('.chat-rows button[aria-expanded]').length } };
    },
    /** Rules 1 and 10: opening lands on the newest message and stays there while rows finish drawing. */
    async open(fixtureId, mode) {
      await ctx.mount(fixtureId, mode, { activity: true, lateReflowMs: LATE_FONT_MS });
      await settled();
      await frames(60);
      return { checks: { atBottom: near(distance()), following: ctx.following() }, data: { distance: distance(), shift: shiftSum } };
    },
    /** Rule 2: a streaming reply keeps a following reader at the bottom in every painted frame. */
    async followStream(fixtureId, mode) {
      await open(fixtureId, mode);
      const worst = await during(distance, streamFor(80));
      return { checks: { heldBottomEveryFrame: near(worst), following: ctx.following() }, data: { worst, shift: shiftSum } };
    },
    /** Rules 3 and 10: any upward scroll of the reader's own leaves Following and shows the button. */
    async nudge(fixtureId, mode) {
      await open(fixtureId, mode);
      await readerScroll(-12);
      await frames(5);
      return { checks: { leftFollowing: !ctx.following() }, data: { distance: distance() } };
    },
    /** Rule 4: streaming below never moves the message being read. */
    async readStream(fixtureId, mode) {
      await open(fixtureId, mode);
      await toMiddle();
      const reading = held();
      const worst = await during(reading.moved, streamFor(80));
      return { checks: { heldRow: near(worst), notFollowing: !ctx.following() }, data: { worst, edge: reading.edge, shift: shiftSum } };
    },
    /** Rules 4 and 6: walking to the top moves nothing the reader did not scroll, and never shows a Load bar. */
    async readWalk(fixtureId, mode) {
      await open(fixtureId, mode);
      const el = ctx.host();
      let worst = 0, loadBarSeen = false, swipes = 0, stillAtTop = 0;
      while (stillAtTop < 30 && swipes < 400) {
        const reading = held();
        const before = el.scrollTop;
        (pageMode() ? window : el).dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true }));
        el.scrollTop = before - 300;
        // The reader's own scroll moves the row by exactly this much; anything beyond it is a jump.
        const owed = before - el.scrollTop;
        for (let i = 0; i < 6; i += 1) {
          await afterPaint();
          const moved = reading.moved();
          if (!Number.isNaN(moved)) worst = Math.max(worst, Math.abs(moved - owed));
        }
        loadBarSeen ||= Array.from(document.querySelectorAll('button')).some((button) => /load all/i.test(button.textContent ?? ''));
        swipes += 1;
        stillAtTop = el.scrollTop <= 0 && !ctx.isLoading() ? stillAtTop + 1 : 0;
      }
      return { checks: { reachedTop: stillAtTop >= 30, noJumps: near(worst), noLoadBar: !loadBarSeen }, data: { worst, swipes, shift: shiftSum } };
    },
    /** Rule 5: opening a tool card while reading leaves the card where it was. */
    async toggleReading(fixtureId, mode): Promise<ScenarioResult> {
      await open(fixtureId, mode);
      await toMiddle();
      let target = toggleIn(0.1, 0.6);
      for (let i = 0; !target && i < 60; i += 1) { await readerScroll(-200); target = toggleIn(0.1, 0.6); }
      await settled();
      target = toggleIn(0.1, 0.6);
      if (!target?.button) return { checks: { foundToggle: false }, data: {} };
      const start = target.row.getBoundingClientRect().top;
      target.button.click();
      await frames(30);
      const moved = Math.round(target.row.getBoundingClientRect().top - start);
      return { checks: { foundToggle: true, cardStayed: near(Math.abs(moved)) }, data: { moved } };
    },
    /** Rule 5: toggling a card while following at the end keeps the end. */
    async toggleFollowing(fixtureId, mode): Promise<ScenarioResult> {
      const start = await open(fixtureId, mode);
      ctx.appendToolRow();
      await settled();
      const target = toggleIn(0, 1);
      if (!target?.button) return { checks: { foundToggle: false }, data: start };
      target.button.click();
      await frames(30);
      return { checks: { foundToggle: true, atBottom: near(distance()), following: ctx.following() }, data: { distance: distance() } };
    },
    /** Rule 2: a growing composer keeps a following reader at the bottom. */
    async composerFollow(fixtureId, mode) {
      await open(fixtureId, mode);
      const composer = document.getElementById('bench-composer') as HTMLTextAreaElement;
      composer.value = 'line\n'.repeat(6);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(30);
      return { checks: { atBottom: near(distance()), following: ctx.following() }, data: { distance: distance() } };
    },
    /** Rule 4: a growing composer never moves the message being read. */
    async composerRead(fixtureId, mode) {
      await open(fixtureId, mode);
      await toMiddle();
      const reading = held();
      const composer = document.getElementById('bench-composer') as HTMLTextAreaElement;
      composer.value = 'line\n'.repeat(6);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(30);
      return { checks: { heldRow: near(Math.abs(reading.moved())) }, data: { moved: reading.moved() } };
    },
    /** Rule 9: the keyboard opening keeps a following reader at the bottom. */
    async keyboardFollow(fixtureId, mode) {
      await open(fixtureId, mode);
      await ctx.resize(innerWidth, Math.round(innerHeight * 0.6));
      await frames(30);
      return { checks: { atBottom: near(distance()), following: ctx.following() }, data: { distance: distance() } };
    },
    /** Rule 9: rotating or resizing keeps the message being read. */
    async resizeRead(fixtureId, mode) {
      await open(fixtureId, mode);
      await toMiddle();
      const reading = held();
      await ctx.resize(Math.round(innerWidth * 1.6), innerHeight);
      await frames(30);
      return { checks: { heldRow: near(Math.abs(reading.moved())) }, data: { moved: reading.moved(), edge: reading.edge } };
    },
    /** Rule 7: a Find jump centres its target, and the jump button rejoins the newest messages. */
    async jumpReturn(fixtureId, mode) {
      await open(fixtureId, mode);
      const snippet = await ctx.earlyPromptSnippet();
      const total = snippet ? await ctx.find(snippet) : 0;
      const current = () => {
        const highlight = (CSS as unknown as { highlights?: Map<string, Iterable<Range>> }).highlights?.get('chat-find-current');
        const range = highlight ? Array.from(highlight)[0] : undefined;
        return range?.getBoundingClientRect() ?? document.querySelector('.chat-find-current-fallback')?.getBoundingClientRect() ?? null;
      };
      for (let i = 0; i < 300 && !current(); i += 1) await afterPaint();
      await settled();
      const { top, bottom } = band();
      const rect = current();
      const offCentre = rect ? Math.round((rect.top + rect.bottom) / 2 - (top + bottom) / 2) : null;
      const leftFollowing = !ctx.following();
      ctx.closeFind();
      ctx.returnToLatest();
      await settled();
      await frames(30);
      return {
        checks: { found: total > 0, targetShown: !!rect, centred: offCentre !== null && Math.abs(offCentre) <= (bottom - top) / 4,
          leftFollowing, backAtBottom: near(distance()), followingAgain: ctx.following() },
        data: { total, offCentre, distance: distance() },
      };
    },
    /** Rule 9: a background refresh never moves the message being read. */
    async refreshRead(fixtureId, mode) {
      await open(fixtureId, mode);
      await toMiddle();
      const reading = held();
      await ctx.refresh();
      await frames(30);
      return { checks: { heldRow: near(Math.abs(reading.moved())) }, data: { moved: reading.moved() } };
    },
    /** Rule 8: with text selected, streaming never scrolls the view. */
    async selectionStream(fixtureId, mode): Promise<ScenarioResult> {
      await open(fixtureId, mode);
      const { top, bottom } = band();
      const row = Array.from(document.querySelectorAll<HTMLElement>('.chat-rows p, .chat-rows li')).reverse().find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top > top && rect.bottom < bottom && (candidate.textContent ?? '').trim().length > 20;
      });
      if (!row) return { checks: { foundRow: false }, data: {} };
      const range = document.createRange();
      range.selectNodeContents(row);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      await frames(5);
      const start = row.getBoundingClientRect().top;
      const worst = await during(() => row.getBoundingClientRect().top - start, streamFor(40));
      document.getSelection()?.removeAllRanges();
      return { checks: { foundRow: true, nothingMoved: near(worst) }, data: { worst } };
    },
  };
  return scenarios;
}
