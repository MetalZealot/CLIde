import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useSettingsNavigation } from './useSettingsNavigation';

type Navigation = ReturnType<typeof useSettingsNavigation>;

describe('useSettingsNavigation browser history', () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigation: Navigation | null;
  let pushedStates: unknown[];
  let backCalls: number;
  let goCalls: number[];
  let originalPushState: History['pushState'];
  let originalBack: History['back'];
  let originalGo: History['go'];

  const currentNavigation = () => {
    assert.ok(navigation);
    return navigation;
  };

  const Harness = ({
    isOpen,
    initialScreenId,
    onClose,
  }: {
    isOpen: boolean;
    initialScreenId?: string;
    onClose: () => void;
  }) => {
    navigation = useSettingsNavigation({
      isOpen,
      initialScreenId,
      mode: 'stack',
      onClose,
    });
    return null;
  };

  const render = async (props: React.ComponentProps<typeof Harness>) => {
    await React.act(async () => root.render(<Harness {...props} />));
  };

  const popHistory = async () => {
    await React.act(async () => {
      window.dispatchEvent(new window.PopStateEvent('popstate'));
    });
  };

  beforeEach(() => {
    navigation = null;
    pushedStates = [];
    backCalls = 0;
    goCalls = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    originalPushState = window.history.pushState;
    originalBack = window.history.back;
    originalGo = window.history.go;
    window.history.pushState = ((state: unknown) => {
      pushedStates.push(state);
    }) as History['pushState'];
    window.history.back = (() => {
      backCalls += 1;
    }) as History['back'];
    window.history.go = ((delta?: number) => {
      goCalls.push(delta ?? 0);
    }) as History['go'];
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    container.remove();
    window.history.pushState = originalPushState;
    window.history.back = originalBack;
    window.history.go = originalGo;
  });

  test('Back at the root consumes its guard and closes Settings', async () => {
    let closeCalls = 0;
    await render({ isOpen: true, onClose: () => { closeCalls += 1; } });

    assert.deepEqual(pushedStates, [{ __clideSettingsDepth: 0 }]);

    await popHistory();

    assert.equal(closeCalls, 1);
    assert.equal(currentNavigation().atRoot, true);
  });

  test('Back pops drill-down screens before it closes Settings', async () => {
    let closeCalls = 0;
    await render({ isOpen: true, onClose: () => { closeCalls += 1; } });

    await React.act(async () => currentNavigation().push('appearance'));
    assert.deepEqual(pushedStates, [
      { __clideSettingsDepth: 0 },
      { __clideSettingsDepth: 1 },
    ]);

    await React.act(async () => currentNavigation().goBack());
    assert.equal(backCalls, 1);
    await popHistory();
    assert.equal(closeCalls, 0);
    assert.equal(currentNavigation().atRoot, true);

    await popHistory();
    assert.equal(closeCalls, 1);
  });

  test('a deep link seeds the root guard and every screen above it', async () => {
    await render({
      isOpen: true,
      initialScreenId: 'appearance.editor',
      onClose: () => {},
    });

    assert.deepEqual(pushedStates, [
      { __clideSettingsDepth: 0 },
      { __clideSettingsDepth: 1 },
      { __clideSettingsDepth: 2 },
    ]);
    assert.equal(currentNavigation().depth, 2);
  });

  test('a search jump adds every screen above the existing root guard', async () => {
    await render({ isOpen: true, onClose: () => {} });

    await React.act(async () => currentNavigation().jumpTo('appearance.editor'));

    assert.deepEqual(pushedStates, [
      { __clideSettingsDepth: 0 },
      { __clideSettingsDepth: 1 },
      { __clideSettingsDepth: 2 },
    ]);
    assert.equal(currentNavigation().depth, 2);
  });

  test('the close button unwinds the root guard and drill-down entries together', async () => {
    let closeCalls = 0;
    await render({ isOpen: true, onClose: () => { closeCalls += 1; } });
    await React.act(async () => currentNavigation().push('appearance'));

    await React.act(async () => currentNavigation().close());

    assert.deepEqual(goCalls, [-2]);
    assert.equal(closeCalls, 0);

    await popHistory();
    assert.equal(closeCalls, 1);
    assert.equal(currentNavigation().atRoot, true);
  });
});
