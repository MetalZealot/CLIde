// Flight recorder: what it keeps, what it never keeps, and how much.
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';

import {
  RECORDER_QUERY_PARAM,
  createFlightRecorder,
  flightRecorder,
  redactError,
  startFlightRecorder,
  stopFlightRecorder,
} from './flightRecorder';

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
}

const SESSION = '1a2b3c4d-0000-4000-8000-000000000000';
const RUN = '9f8e7d6c-0000-4000-8000-000000000000';

describe('flightRecorder', () => {
  let storage: MemoryStorage;
  let clock: number;

  const make = (bootId = 'b001') => createFlightRecorder({
    storage, bootId, environment: 'test', now: () => clock,
  });

  /** Dispatches one frame the way WebSocketContext does. */
  const dispatch = (
    recorder: ReturnType<typeof make>,
    frame: Record<string, unknown>,
    handle: () => void = () => {},
  ) => {
    const event = recorder.beginFrame(frame, 3);
    try {
      handle();
    } catch (error) {
      recorder.noteError(error);
    }
    recorder.endFrame(event);
    clock += 10;
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    clock = Date.UTC(2026, 9, 6, 19, 0, 0);
  });

  test('records kinds, short ids and handler notes, never contents', () => {
    const recorder = make();
    dispatch(recorder, {
      kind: 'text', sessionId: SESSION, runId: RUN, seq: 4,
      content: 'my private prompt', input: { command: 'cat secrets.env' },
    }, () => recorder.note('stored'));

    const report = recorder.report();
    assert.match(report, /19:00:00\.000 frame text s=1a2b3c4d run=9f8e7d6c seq=4 listeners=3 stored/);
    assert.doesNotMatch(report, /private|secrets/);
  });

  test('a handler that throws is named with its redacted error and stack', () => {
    const recorder = make();
    dispatch(recorder, { kind: 'scheduled_message_sent', sessionId: SESSION }, () => {
      throw new TypeError(`Cannot read properties of undefined (reading 'id') near "a long user sentence"`);
    });

    const report = recorder.report();
    assert.match(report, /frame scheduled_message_sent s=1a2b3c4d listeners=3 threw — TypeError: Cannot read properties of undefined \(reading 'id'\) near "…"/);
    assert.match(report, / \| at /, 'top stack frames are kept');
    assert.doesNotMatch(report, /long user sentence/);
  });

  test('redaction cuts query strings and hosts, keeps file and line', () => {
    const error = new Error(`The URL 'ws://pi:3001/ws?token=abc.def' is invalid`);
    error.stack = 'Error: x\n    at connect (https://pi.example:9442/assets/index-AbC.js?v=1:2:345)';
    const line = redactError(error);
    assert.doesNotMatch(line, /token|abc\.def|pi\.example/);
    assert.match(line, /at connect \(\/assets\/index-AbC\.js:2:345\)/);
  });

  test('consecutive identical frames collapse into one line with a seq range', () => {
    const recorder = make();
    for (let seq = 10; seq < 15; seq += 1) {
      dispatch(recorder, { kind: 'stream_delta', sessionId: SESSION, runId: RUN, seq }, () => recorder.note('buffered'));
    }
    dispatch(recorder, { kind: 'complete', sessionId: SESSION, runId: RUN, seq: 15 });

    const lines = recorder.report().split('\n').filter((line) => line.includes(' frame '));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /stream_delta s=1a2b3c4d run=9f8e7d6c ×5 seq=10–14/);
  });

  test('anything a handler sends is listed after the frame that caused it', () => {
    const recorder = make();
    dispatch(recorder, { kind: 'complete', sessionId: SESSION }, () => {
      recorder.send({ type: 'chat.subscribe', sessions: [{ sessionId: SESSION, lastSeq: 3 }] }, true);
    });
    const lines = recorder.report().split('\n');
    const frame = lines.findIndex((line) => line.includes('frame complete'));
    const send = lines.findIndex((line) => line.includes('send chat.subscribe s=1a2b3c4d sent'));
    assert.ok(frame >= 0 && send > frame, lines.join('\n'));
  });

  test('a note outside dispatch is ignored', () => {
    const recorder = make();
    recorder.note('stored');
    recorder.noteError(new Error('x'));
    assert.doesNotMatch(recorder.report(), /stored|threw/);
  });

  test('retention keeps a bounded number of events and page loads, and drops corrupt ones', () => {
    for (const boot of ['old1', 'old2', 'old3']) {
      clock += 1000;
      const previous = make(boot);
      previous.event('ws.open');
      previous.flush();
    }
    storage.setItem('clide:flight-recorder:v1:junk', '{not json');

    clock += 1000;
    const recorder = make('b009');
    recorder.prune();
    for (let i = 0; i < 400; i += 1) recorder.event('ws.wake', { code: i });
    recorder.flush();

    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    assert.deepEqual(keys.sort(), [
      'clide:flight-recorder:v1:b009',
      'clide:flight-recorder:v1:old2',
      'clide:flight-recorder:v1:old3',
    ]);
    const lines = recorder.report().split('\n');
    assert.ok(lines.length <= 254, `report stays pasteable (${lines.length} lines)`);
    assert.match(lines.at(-1)!, /ws\.wake code=399$/);
    assert.match(lines.join('\n'), /older lines omitted/);
  });

  test('clear empties every page load, including this one', () => {
    const previous = make('old1');
    previous.event('ws.open');
    previous.flush();
    const recorder = make('b002');
    recorder.event('ws.close', { code: 1006 });
    recorder.clear();
    assert.doesNotMatch(recorder.report(), /ws\./);
    assert.equal(storage.getItem('clide:flight-recorder:v1:old1'), null);
  });

  describe('activation', () => {
    afterEach(() => {
      stopFlightRecorder();
      window.history.replaceState(null, '', '/');
    });

    test('off by default, so every call site gets null', () => {
      startFlightRecorder();
      assert.equal(flightRecorder(), null);
      assert.equal(document.querySelector('[data-flight-recorder]'), null);
    });

    test('the query switch turns it on for later loads and leaves the URL clean', () => {
      window.history.replaceState(null, '', `/session/abc?${RECORDER_QUERY_PARAM}=1&tab=chat`);
      startFlightRecorder();
      assert.ok(flightRecorder());
      assert.equal(window.location.search, '?tab=chat');
      assert.ok(document.querySelector('[data-flight-recorder]'), 'the Copy/Clear/Off bar is shown');
    });

    test('Off cancels a pending write, so nothing it deleted comes back', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      window.history.replaceState(null, '', `/?${RECORDER_QUERY_PARAM}=1`);
      startFlightRecorder();
      flightRecorder()!.event('ws.open');
      stopFlightRecorder();
      t.mock.timers.tick(5000);
      const kept = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
        .filter((key) => key?.startsWith('clide:flight-recorder'));
      assert.deepEqual(kept, []);
    });

    test('=0 turns it off and deletes what it kept', () => {
      window.localStorage.setItem('clide:flight-recorder:on', '1');
      window.localStorage.setItem('clide:flight-recorder:v1:old1', '{}');
      window.history.replaceState(null, '', `/?${RECORDER_QUERY_PARAM}=0`);
      startFlightRecorder();
      assert.equal(flightRecorder(), null);
      assert.equal(window.localStorage.getItem('clide:flight-recorder:v1:old1'), null);
    });
  });
});
