// Session store: pagination authority and optimistic-echo reconciliation.
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { removeOptimisticUserEchoes } from './sessionMessageReconciliation';
import { type NormalizedMessage, type SessionStore, useSessionStore } from './useSessionStore';

describe('useSessionStore.pagination', () => {
  /**
   * Pagination and watcher-refresh coverage for the session store.
   *
   * The post-v1.37 merge handoff makes two of these load-bearing rules:
   *
   *   "Keep one pagination authority. Do not reintroduce duplicated
   *    hasMoreMessages, load locks, or watcher-driven full-history replacement
   *    merely because an upstream component expects the old shape."
   *
   * and, from the accepted scroll work, "reconnect and watcher refreshes retain
   * the currently loaded window" plus "the anchor is armed before the store
   * notifies React". Those are contracts between the store and ChatMessagesPane
   * that no amount of typechecking enforces, so they are asserted here.
   *
   * Run with `npm run test:client`.
   */








  const SESSION_ID = 'session-under-test';

  const message = (id: string, content: string): NormalizedMessage => ({
    id,
    sessionId: SESSION_ID,
    timestamp: new Date(Number(id.replace(/\D/g, '')) * 1000).toISOString(),
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content,
  });

  type Page = { messages: NormalizedMessage[]; total?: number; hasMore?: boolean; nextCursor?: string | null; status?: number; error?: { code: string } };

  const pageResponse = (page: Page) =>
    ({
      ok: !page.status,
      status: page.status ?? 200,
      headers: { get: () => null },
      json: async () => ({
        error: page.error,
        nextCursor: page.nextCursor,
        messages: page.messages,
        total: page.total ?? page.messages.length,
        hasMore: page.hasMore ?? false,
      }),
    }) as unknown as Response;

  let requestedUrls: string[];
  let requestedSignals: AbortSignal[];
  let respond: (page: Page) => void;
  let originalFetch: typeof globalThis.fetch;
  let container: HTMLElement;
  let root: Root;
  let store: SessionStore;
  let renders: number;

  /**
   * Every fetch parks on a deferred so tests can control resolution order —
   * which is the whole point of the stale-response cases below.
   */
  const installFetchQueue = () => {
    const pending: Array<(response: Response) => void> = [];
    requestedUrls = [];
    requestedSignals = [];

    originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      value: (url: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          requestedUrls.push(url);
          requestedSignals.push(options.signal!);
          pending.push(resolve);
        }),
      configurable: true,
      writable: true,
    });

    respond = (page: Page) => {
      const resolve = pending.shift();
      assert.ok(resolve, 'expected a pending request to respond to');
      resolve(pageResponse(page));
    };
  };

  const settle = async () => {
    await React.act(async () => {
      for (let i = 0; i < 6; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  };

  /**
   * Store operations notify subscribers synchronously before they await, so both
   * ends of one have to happen inside `act()` or React warns about an unwrapped
   * update — which would drown out a genuine one.
   *
   * The in-flight operation comes back boxed on purpose: awaiting a bare
   * `Promise<Promise<T>>` flattens both levels, so `begin` would block on the
   * very request the test still has to respond to.
   */
  const begin = async <T,>(start: () => T): Promise<{ pending: T }> => {
    let started!: T;
    await React.act(async () => {
      started = start();
    });
    return { pending: started };
  };

  const finish = async (pending: Promise<unknown> | Array<Promise<unknown>>) => {
    await React.act(async () => {
      await (Array.isArray(pending) ? Promise.all(pending) : pending);
    });
  };

  beforeEach(async () => {
    installFetchQueue();
    renders = 0;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const Probe = () => {
      renders += 1;
      store = useSessionStore();
      store.setActiveSession(SESSION_ID);
      return null;
    };

    await React.act(async () => {
      root.render(React.createElement(Probe, null));
    });
  });

  afterEach(async () => {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  });

  /** Loads the newest page and leaves older history unloaded. */
  const loadFirstPage = async () => {
    const { pending: fetching } = await begin(() => store.fetchFromServer(SESSION_ID, { limit: 2, offset: 0 }));
    await settle();
    respond({ messages: [message('3', 'three'), message('4', 'four')], total: 4, hasMore: true });
    await finish(fetching);
  };

  test('the first page seeds pagination state from the response, not the caller', async () => {
    await loadFirstPage();

    const slot = store.getSessionSlot(SESSION_ID)!;
    assert.equal(slot.hasMore, true);
    assert.equal(slot.offset, 2, 'offset advances by the number of rows actually returned');
    assert.equal(slot.total, 4);
    assert.deepEqual(store.getMessages(SESSION_ID).map((m) => m.content), ['three', 'four']);
  });

  test('fetchMore prepends older rows and advances the window', async () => {
    await loadFirstPage();

    const { pending: fetching } = await begin(() => store.fetchMore(SESSION_ID, { limit: 2 }));
    await settle();
    assert.match(requestedUrls.at(-1)!, /limit=2&offset=2/, 'older page is requested from the window edge');
    respond({ messages: [message('1', 'one'), message('2', 'two')], total: 4, hasMore: false });
    await finish(fetching);

    const slot = store.getSessionSlot(SESSION_ID)!;
    assert.deepEqual(
      store.getMessages(SESSION_ID).map((m) => m.content),
      ['one', 'two', 'three', 'four'],
    );
    assert.equal(slot.offset, 4);
    assert.equal(slot.hasMore, false);
  });

  test('fetchMore is a no-op once the roof is reached', async () => {
    await loadFirstPage();

    const { pending: fetching } = await begin(() => store.fetchMore(SESSION_ID, { limit: 2 }));
    await settle();
    respond({ messages: [message('1', 'one')], hasMore: false });
    await finish(fetching);

    const urlsBefore = requestedUrls.length;
    await React.act(async () => {
      await store.fetchMore(SESSION_ID, { limit: 2 });
    });

    assert.equal(requestedUrls.length, urlsBefore, 'exhausted history must not keep requesting pages');
  });

  test('the prepend anchor is armed before subscribers re-render', async () => {
    await loadFirstPage();

    let contentAtCallback: string[] | null = null;
    let rendersAtCallback = -1;

    const { pending: fetching } = await begin(() => store.fetchMore(SESSION_ID, {
      limit: 2,
      onBeforeNotify: (slot) => {
        // The pane restores scroll off this callback; if the older rows are not
        // in the slot yet, or React has already painted, the anchor is useless.
        contentAtCallback = slot.serverMessages.map((m) => m.content!);
        rendersAtCallback = renders;
      },
    }));
    await settle();
    respond({ messages: [message('1', 'one'), message('2', 'two')], hasMore: false });
    await finish(fetching);

    assert.deepEqual(contentAtCallback, ['one', 'two', 'three', 'four']);
    assert.ok(
      renders > rendersAtCallback,
      'onBeforeNotify must run before the notify that re-renders subscribers',
    );
  });

  test('an empty older page does not arm the anchor', async () => {
    await loadFirstPage();

    let armed = false;
    const { pending: fetching } = await begin(() => store.fetchMore(SESSION_ID, {
      limit: 2,
      onBeforeNotify: () => {
        armed = true;
      },
    }));
    await settle();
    respond({ messages: [], hasMore: false });
    await finish(fetching);

    assert.equal(armed, false, 'nothing was prepended, so there is no scroll to preserve');
  });

  test('refresh and full fetch reuse unchanged records but apply nested changes and removals', async () => {
    await loadFirstPage();
    const original = store.getMessages(SESSION_ID);
    let operation: { pending: Promise<unknown> } = await begin(() => store.refreshFromServer(SESSION_ID));
    respond({ messages: JSON.parse(JSON.stringify(original)), hasMore: true });
    await finish(operation.pending);
    assert.equal(store.getMessages(SESSION_ID), original);
    operation = await begin(() => store.fetchFromServer(SESSION_ID));
    respond({ messages: [JSON.parse(JSON.stringify(original[0])), { ...original[1], images: [{ data: 'data:image/png;base64,changed' }] }] });
    await finish(operation.pending);
    const changed = store.getMessages(SESSION_ID);
    assert.equal(changed[0], original[0]);
    assert.notEqual(changed[1], original[1]);
    assert.equal(changed[1].images?.[0].data, 'data:image/png;base64,changed');
    operation = await begin(() => store.refreshFromServer(SESSION_ID));
    respond({ messages: [JSON.parse(JSON.stringify(original[0]))] });
    await finish(operation.pending);
    assert.equal(store.getMessages(SESSION_ID).length, 1);
    assert.equal(store.getMessages(SESSION_ID)[0], original[0]);
  });


  test('bookmarks drive paging and refresh; overlapping requests are cancelled and deduplicated', async () => {
    await loadFirstPage();
    store.getSlot(SESSION_ID).nextCursor = 'bookmark-2';
    const { pending: more } = await begin(() => store.fetchMore(SESSION_ID, { limit: 2 }));
    assert.match(requestedUrls.at(-1)!, /before=bookmark-2/);
    const requestCount = requestedUrls.length;
    await begin(() => store.fetchMore(SESSION_ID, { limit: 2 }));
    assert.equal(requestedUrls.length, requestCount, 'only one older-page request');
    respond({ messages: [message('2', 'two'), message('3', 'three')], nextCursor: 'bookmark-1', hasMore: true });
    await finish(more);
    assert.deepEqual(store.getSlot(SESSION_ID).serverMessages.map(m => m.id), ['2', '3', '4']);
    const { pending: refresh } = await begin(() => store.refreshFromServer(SESSION_ID));
    assert.match(requestedUrls.at(-1)!, /from=bookmark-1/);
    respond({ messages: [message('2', 'two'), message('3', 'three'), message('4', 'four'), message('5', 'five')],
      nextCursor: 'bookmark-1-new', hasMore: true });
    await finish(refresh);
    assert.equal(store.getSlot(SESSION_ID).offset, 4, 'append preserves oldest loaded row');
    const { pending: stale } = await begin(() => store.fetchMore(SESSION_ID));
    const signal = requestedSignals.at(-1)!;
    const { pending: latest } = await begin(() => store.refreshFromServer(SESSION_ID));
    assert.equal(signal.aborted, true);
    respond({ messages: [message('1', 'obsolete')], nextCursor: null });
    respond({ messages: [message('5', 'replacement')], nextCursor: null });
    await finish([stale, latest]);
    assert.deepEqual(store.getSlot(SESSION_ID).serverMessages.map(m => m.content), ['replacement']);
  });

  test('invalidated older pages reload the loaded window and arm restoration before notification', async () => {
    await loadFirstPage();
    store.getSlot(SESSION_ID).nextCursor = 'rewound';
    let anchored = false;
    const { pending } = await begin(() => store.fetchMore(SESSION_ID, { limit: 2, onBeforeNotify: slot => {
      assert.deepEqual(slot.serverMessages.map(m => m.id), ['1', '2']);
      anchored = true;
    } }));
    respond({ messages: [], status: 409, error: { code: 'HISTORY_CURSOR_INVALIDATED' } });
    await settle();
    assert.match(requestedUrls.at(-1)!, /limit=2&offset=0/);
    respond({ messages: [message('1', 'one'), message('2', 'two')], nextCursor: null });
    await finish(pending);
    assert.equal(anchored, true);
    assert.equal(store.getSlot(SESSION_ID).hasMore, false);
    assert.equal(store.getSlot(SESSION_ID).nextCursor, null);
  });

  test('a reconnect to replaced history retries once without the old bookmark', async () => {
    await loadFirstPage();
    store.getSlot(SESSION_ID).nextCursor = 'old-branch';
    const { pending } = await begin(() => store.refreshFromServer(SESSION_ID));
    respond({ messages: [], status: 409, error: { code: 'HISTORY_CURSOR_INVALIDATED' } });
    await settle();
    assert.doesNotMatch(requestedUrls.at(-1)!, /from=/);
    respond({ messages: [message('1', 'new branch')], nextCursor: null });
    await finish(pending);
    assert.equal(store.getSlot(SESSION_ID).serverMessages[0].content, 'new branch');
  });

  test('switching session cancels an outstanding page even when fetch ignores abort', async () => {
    await loadFirstPage();
    const { pending } = await begin(() => store.fetchMore(SESSION_ID));
    const signal = requestedSignals.at(-1)!;
    store.setActiveSession('another-session');
    assert.equal(signal.aborted, true);
    respond({ messages: [message('1', 'stale')], nextCursor: null });
    await finish(pending);
    assert.deepEqual(store.getSlot(SESSION_ID).serverMessages.map(m => m.id), ['3', '4']);
  });

  test('optimistic rewind cancels a page that could restore abandoned messages', async () => {
    await loadFirstPage();
    const { pending } = await begin(() => store.fetchMore(SESSION_ID));
    const signal = requestedSignals.at(-1)!;
    await begin(() => store.truncateFromMessageId(SESSION_ID, '4'));
    assert.equal(signal.aborted, true);
    respond({ messages: [message('1', 'old branch')], hasMore: false });
    await finish(pending);
    assert.deepEqual(store.getSlot(SESSION_ID).serverMessages.map(m => m.id), ['3']);
  });

  test('a watcher refresh retains the loaded window instead of pulling all history', async () => {
    await loadFirstPage();

    const { pending: refreshing } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();

    // The regression this guards: omitting pagination here replaced a 2-row view
    // with the whole conversation, blowing up the render and the scroll geometry.
    assert.match(requestedUrls.at(-1)!, /limit=2&offset=0/);

    respond({ messages: [message('3', 'three'), message('4', 'four')], total: 4, hasMore: true });
    await finish(refreshing);

    const slot = store.getSessionSlot(SESSION_ID)!;
    assert.equal(slot.offset, 2, 'the window stays the size the reader had loaded');
    assert.equal(slot.hasMore, true);
  });

  test('a fully loaded history still refreshes in full', async () => {
    const { pending: fetching } = await begin(() => store.fetchFromServer(SESSION_ID, { limit: null }));
    await settle();
    respond({ messages: [message('1', 'one'), message('2', 'two')], total: 2, hasMore: false });
    await finish(fetching);

    const { pending: refreshing } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();
    assert.doesNotMatch(
      requestedUrls.at(-1)!,
      /limit=/,
      'nothing is being preserved, so the refresh is unpaginated',
    );

    respond({ messages: [message('1', 'one'), message('2', 'two')], total: 2, hasMore: false });
    await finish(refreshing);
  });

  test('a stale in-flight page cannot clobber a newer refresh', async () => {
    await loadFirstPage();

    // Older page starts first...
    const { pending: fetchingMore } = await begin(() => store.fetchMore(SESSION_ID, { limit: 2 }));
    await settle();
    // ...a watcher refresh starts second and lands first.
    const { pending: refreshing } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();

    respond({ messages: [message('1', 'one'), message('2', 'two')], hasMore: false }); // fetchMore
    respond({
      messages: [message('3', 'three'), message('4', 'four'), message('5', 'five')],
      total: 5,
      hasMore: true,
    }); // refresh

    await finish([fetchingMore, refreshing]);

    assert.deepEqual(
      store.getMessages(SESSION_ID).map((m) => m.content),
      ['three', 'four', 'five'],
      'the last-started fetch owns the transcript, whatever order responses arrive in',
    );
  });

  test('a refresh prunes only the realtime rows the server now owns', async () => {
    await loadFirstPage();

    await begin(() => {
      store.appendRealtime(SESSION_ID, { ...message('5', 'five'), id: 'local_5' });
      store.appendRealtime(SESSION_ID, { ...message('6', 'six'), id: 'local_6' });
    });

    const { pending: refreshing } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();
    // The server transcript has caught up with "five" but not yet "six".
    respond({
      messages: [message('3', 'three'), message('4', 'four'), message('5', 'five')],
      total: 5,
      hasMore: true,
    });
    await finish(refreshing);

    const contents = store.getMessages(SESSION_ID).map((m) => m.content);
    assert.deepEqual(
      contents,
      ['three', 'four', 'five', 'six'],
      'a blind realtime clear here made the pane flash "Continue your conversation"',
    );
    assert.equal(contents.filter((c) => c === 'five').length, 1, 'no duplicate across the boundary');
  });

  test('a live error row gives way to the same failure once the transcript records it', async () => {
    await loadFirstPage();
    const LIMIT = "You've hit your usage limit.";
    const error = (id: string, seconds: number, content: string): NormalizedMessage => ({
      ...message(id, content),
      id,
      timestamp: new Date(seconds * 1000).toISOString(),
      role: undefined,
      kind: 'error',
    });

    await begin(() => {
      store.appendRealtime(SESSION_ID, error('live_limit', 4.5, LIMIT));
      store.appendRealtime(SESSION_ID, error('live_other', 4.6, 'Connection dropped'));
    });
    const { pending: refreshing } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();
    respond({
      messages: [message('3', 'three'), message('4', 'four'), error('server_limit', 4.7, LIMIT)],
      total: 5,
      hasMore: true,
    });
    await finish(refreshing);

    assert.deepEqual(
      store.getMessages(SESSION_ID).filter((m) => m.kind === 'error').map((m) => m.id),
      ['live_other', 'server_limit'],
      'one row per failure; an error the transcript never recorded stays',
    );

    // The same text in a later turn is a new failure, not an echo of the old one.
    await begin(() => {
      store.appendRealtime(SESSION_ID, { ...message('6', 'six'), id: 'local_6' });
      store.appendRealtime(SESSION_ID, error('live_again', 6.5, LIMIT));
    });
    const { pending: again } = await begin(() => store.refreshFromServer(SESSION_ID));
    await settle();
    respond({
      messages: [message('3', 'three'), message('4', 'four'), error('server_limit', 4.7, LIMIT)],
      total: 5,
      hasMore: true,
    });
    await finish(again);
    assert.ok(store.getMessages(SESSION_ID).some((m) => m.id === 'live_again'));
  });
});

describe('sessionMessageReconciliation', () => {
  const createUserMessage = (
    id: string,
    timestamp: string,
    overrides: Partial<NormalizedMessage> = {},
  ): NormalizedMessage => ({
    id,
    sessionId: 'session-1',
    timestamp,
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content: '',
    ...overrides,
  });

  test('replaces an optimistic image-only turn with its persisted Claude copy', () => {
    const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
      images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png', name: 'image.png' }],
    });
    const persisted = createUserMessage('claude_image', '2026-07-28T20:30:26.000Z', {
      images: [{ data: 'data:image/png;base64,AAAA' }],
    });

    assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
  });

  test('an id-less row passes through instead of throwing', () => {
    // A control frame filed here by mistake used to throw on every append and
    // every refresh, which froze the whole conversation rather than losing one
    // row.
    const persisted = createUserMessage('claude_1', '2026-07-28T20:30:22.000Z');
    const idless = { kind: 'text', sessionId: 's1', content: 'x' } as unknown as NormalizedMessage;

    assert.deepEqual(removeOptimisticUserEchoes([persisted], [idless]), [idless]);
  });

  test('does not collapse an attachment-only turn into a server row without attachments', () => {
    const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
      images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png' }],
    });
    const persisted = createUserMessage('claude_empty', '2026-07-28T20:30:22.000Z');

    assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), [local]);
  });

  test('matches optimistic attachment turns to persisted turns one-to-one', () => {
    const firstLocal = createUserMessage('local_first', '2026-07-28T20:30:21.000Z', {
      images: [{ path: 'C:/Users/test/.cloudcli/assets/first.png' }],
    });
    const secondLocal = createUserMessage('local_second', '2026-07-28T20:30:25.000Z', {
      images: [{ path: 'C:/Users/test/.cloudcli/assets/second.png' }],
    });
    const firstPersisted = createUserMessage('claude_first', '2026-07-28T20:30:22.000Z', {
      images: [{ data: 'data:image/png;base64,AAAA' }],
    });

    const remainingRealtime = removeOptimisticUserEchoes(
      [firstPersisted],
      [firstLocal, secondLocal],
    );

    assert.deepEqual(remainingRealtime.map((message) => message.id), ['local_second']);
  });

  test('keeps the existing optimistic text reconciliation behavior', () => {
    const local = createUserMessage('local_text', '2026-07-28T20:30:21.000Z', {
      content: 'hello',
    });
    const persisted = createUserMessage('claude_text', '2026-07-28T20:30:26.000Z', {
      content: 'hello',
    });

    assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
  });
});

describe('useSessionStore.sessionSettings', () => {
  /**
   * One owner for a session's model and effort.
   *
   * Effort used to live in localStorage under `<provider>-effort`, one value
   * per provider, so every session on a provider displayed and sent whatever
   * the last one picked. These assert the replacement: a value reaches a slot
   * only when the backend says it belongs to that session.
   */
  const SESSION_A = 'session-a';
  const SESSION_B = 'session-b';

  type SettingsResponse = { model?: unknown; effort?: unknown; source?: unknown };

  let requestedUrls: string[];
  let responses: Map<string, SettingsResponse>;
  /** Set to hold every settings response open, so a pick can land mid-flight. */
  let gate: Promise<void> | null;
  let originalFetch: typeof globalThis.fetch;
  let container: HTMLElement;
  let root: Root;
  let store: SessionStore;

  const jsonResponse = (data: unknown) =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ success: true, data }),
    }) as unknown as Response;

  const respondFor = (url: string): Response => {
    const key = url.includes('/active-model') ? 'model' : 'effort';
    const sessionId = url.includes(SESSION_B) ? SESSION_B : SESSION_A;
    const configured = responses.get(`${sessionId}:${key}`) ?? {};
    return jsonResponse(configured);
  };

  beforeEach(async () => {
    requestedUrls = [];
    responses = new Map();
    gate = null;

    originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      value: async (url: string) => {
        requestedUrls.push(url);
        if (gate) await gate;
        return respondFor(url);
      },
      configurable: true,
      writable: true,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const Probe = () => {
      store = useSessionStore();
      store.setActiveSession(SESSION_A);
      return null;
    };

    await React.act(async () => {
      root.render(React.createElement(Probe, null));
    });
  });

  afterEach(async () => {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  });

  const fetchSettings = async (sessionId: string) => {
    await React.act(async () => {
      await store.fetchSessionSettings(sessionId, 'claude');
    });
  };

  test('one fetch fills both the model and the effort for a session', async () => {
    responses.set(`${SESSION_A}:model`, { model: 'opus', source: 'pick' });
    responses.set(`${SESSION_A}:effort`, { effort: 'medium', source: 'pick' });

    await fetchSettings(SESSION_A);

    const slot = store.getSessionSlot(SESSION_A)!;
    assert.equal(slot.model, 'opus');
    assert.equal(slot.effort, 'medium');
    assert.equal(slot.effortSource, 'pick');
    assert.equal(slot.effortStatus, 'idle');
  });

  test('effort recorded by the provider transcript is session-scoped too', async () => {
    responses.set(`${SESSION_A}:effort`, { effort: 'xhigh', source: 'transcript' });

    await fetchSettings(SESSION_A);

    assert.equal(store.getSessionSlot(SESSION_A)!.effort, 'xhigh');
    assert.equal(store.getSessionSlot(SESSION_A)!.effortSource, 'transcript');
  });

  test('a backend fallback is not adopted as the session\'s own', async () => {
    responses.set(`${SESSION_A}:model`, { model: 'sonnet', source: 'default' });
    responses.set(`${SESSION_A}:effort`, { effort: 'high', source: 'default' });

    await fetchSettings(SESSION_A);

    // Storing the fallback would feed it back into the send path and override
    // the user's own provider-level choice.
    const slot = store.getSessionSlot(SESSION_A)!;
    assert.equal(slot.model, null);
    assert.equal(slot.effort, null);
    assert.equal(slot.effortSource, null);
  });

  test('two sessions hold their own effort', async () => {
    responses.set(`${SESSION_A}:effort`, { effort: 'medium', source: 'pick' });
    responses.set(`${SESSION_B}:effort`, { effort: 'high', source: 'pick' });

    await fetchSettings(SESSION_A);
    await fetchSettings(SESSION_B);

    assert.equal(store.getSessionSlot(SESSION_A)!.effort, 'medium');
    assert.equal(store.getSessionSlot(SESSION_B)!.effort, 'high');
  });

  test('a cached settings read is reused, and a cleared effort is refetched', async () => {
    responses.set(`${SESSION_A}:model`, { model: 'opus', source: 'pick' });
    responses.set(`${SESSION_A}:effort`, { effort: 'medium', source: 'pick' });

    await fetchSettings(SESSION_A);
    const afterFirst = requestedUrls.length;

    await fetchSettings(SESSION_A);
    assert.equal(requestedUrls.length, afterFirst, 'a fresh slot should not refetch');

    // Rolling back a failed write has to look unresolved again, or the TTL
    // suppresses the very refetch that would restore the real value.
    await React.act(async () => {
      store.setEffort(SESSION_A, null);
    });
    responses.set(`${SESSION_A}:effort`, { effort: 'high', source: 'pick' });
    await fetchSettings(SESSION_A);

    assert.equal(store.getSessionSlot(SESSION_A)!.effort, 'high');
    assert.ok(
      requestedUrls.filter((url) => url.includes('/effort')).length > 1,
      'a cleared effort should be refetched',
    );
  });

  test('a promoted seed becomes the new session\'s own effort, not a refetchable blank', async () => {
    // A brand-new chat runs on the provider seed until the gateway allocates
    // its stable id; promotion hands that effort to the session, and the
    // backend has no row to resolve against yet.
    const NEW_SESSION = SESSION_B;
    await React.act(async () => {
      store.setEffort(NEW_SESSION, 'high');
    });

    responses.set(`${NEW_SESSION}:effort`, { effort: 'low', source: 'default' });
    await fetchSettings(NEW_SESSION);

    assert.equal(store.getSessionSlot(NEW_SESSION)!.effort, 'high');
    assert.equal(store.getSessionSlot(NEW_SESSION)!.effortSource, 'pick');
    assert.equal(
      requestedUrls.filter((url) => url.includes('/effort')).length,
      0,
      'a promoted effort is already resolved, so nothing refetches over it',
    );
  });

  test('a pick beats the settings read it raced', async () => {
    // The GET answers with what the backend knew before the pick; applying it
    // last would silently roll the composer back, and a non-session-scoped
    // answer rolls it back to nothing at all.
    responses.set(`${SESSION_A}:model`, { model: 'sonnet', source: 'default' });
    responses.set(`${SESSION_A}:effort`, { effort: 'low', source: 'default' });

    let release = () => {};
    gate = new Promise<void>((resolve) => { release = resolve; });

    let settled: Promise<unknown> = Promise.resolve();
    await React.act(async () => {
      settled = store.fetchSessionSettings(SESSION_A, 'claude');
    });

    await React.act(async () => {
      store.setModel(SESSION_A, 'opus');
      store.setEffort(SESSION_A, 'max');
      release();
      await settled;
    });

    const slot = store.getSessionSlot(SESSION_A)!;
    assert.equal(slot.model, 'opus');
    assert.equal(slot.effort, 'max');
    assert.equal(slot.effortSource, 'pick');
    assert.equal(slot.modelStatus, 'idle');
  });

  test('an optimistic effort is owned by its own session', async () => {
    await React.act(async () => {
      store.setEffort(SESSION_A, 'max');
    });

    assert.equal(store.getSessionSlot(SESSION_A)!.effort, 'max');
    assert.equal(store.getSessionSlot(SESSION_B)?.effort ?? null, null);
  });
});
