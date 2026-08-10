/**
 * Preload for client tests that need to actually mount React.
 *
 *   npx tsx --tsconfig server/tsconfig.json \
 *     --import ./src/test/setup-client-env.ts --test <client test files>
 *
 * Pure client tests (`renderToStaticMarkup`, plain functions) do not need this.
 * It exists for tests whose subject is an effect, a subscription, or a hook
 * identity — none of which run without a DOM.
 *
 * Two things the browser hands us for free and bare Node does not:
 *
 * 1. `import.meta.env`. Vite injects it; under tsx it is `undefined`, so
 *    `src/constants/config.ts` throws on import and takes every module that
 *    transitively reaches it down with it. A `load` hook defines it per module
 *    so `IS_PLATFORM` resolves to `false`, matching a self-hosted build.
 * 2. A DOM. `react-dom/client`, `localStorage`, and `window` events are all
 *    load-bearing for the components under test.
 * 3. A predictable locale. Components deliberately call `Intl` with `undefined`
 *    so users get their own formatting, but that makes assertions depend on the
 *    machine: this Pi is `en_GB`, which renders USD as `US$0.00` and compact
 *    millions as `1.25m`, failing `TokenUsageSummary` tests written against
 *    `en-US`. Node fixes ICU's default at startup, so an env var set from here
 *    is already too late — the constructors are pinned instead.
 */
import { registerHooks } from 'node:module';

import { JSDOM } from 'jsdom';

// Vite resolves these to real modules; Node refuses to load them at all. Any
// component graph deep enough to reach a stylesheet or an icon asset would
// otherwise fail at import time rather than at assertion time.
const ASSET_EXTENSIONS = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?)(\?.*)?$/;

registerHooks({
  load(url, context, nextLoad) {
    if (ASSET_EXTENSIONS.test(url)) {
      return { format: 'module', source: 'export default {};', shortCircuit: true };
    }

    const result = nextLoad(url, context);

    if (!result.source || url.includes('/node_modules/')) {
      return result;
    }

    const source = result.source.toString();
    if (!source.includes('import.meta.env')) {
      return result;
    }

    return { ...result, source: `import.meta.env ??= {};\n${source}` };
  },
});

const TEST_LOCALE = 'en-US';

// `Intl.NumberFormat` and `Intl.DateTimeFormat` are callable with and without
// `new`, so both traps are needed; everything else forwards untouched. An
// explicit locale passed by a caller still wins.
type LocaleAwareCtor = typeof Intl.NumberFormat | typeof Intl.DateTimeFormat;

const pinDefaultLocale = <T extends LocaleAwareCtor>(Ctor: T): T => new Proxy(Ctor, {
  construct: (target, [locales, options]: [Intl.LocalesArgument?, object?]) =>
    Reflect.construct(target, [locales ?? TEST_LOCALE, options]),
  apply: (target, thisArg, [locales, options]: [Intl.LocalesArgument?, object?]) =>
    Reflect.apply(target as (...args: unknown[]) => unknown, thisArg, [locales ?? TEST_LOCALE, options]),
}) as T;

Intl.NumberFormat = pinDefaultLocale(Intl.NumberFormat);
Intl.DateTimeFormat = pinDefaultLocale(Intl.DateTimeFormat);

// `toLocaleString` reaches ICU's default directly rather than through the
// constructors above, so a `de-DE` machine would still see `117.721`.
type LocaleStringHost = { toLocaleString: (...args: unknown[]) => string };

const pinToLocaleString = (proto: LocaleStringHost) => {
  const original = proto.toLocaleString;
  proto.toLocaleString = function toLocaleString(this: unknown, ...args: unknown[]) {
    const [locales, options] = args;
    return original.call(this, locales ?? TEST_LOCALE, options);
  };
};

pinToLocaleString(Number.prototype as unknown as LocaleStringHost);
pinToLocaleString(Date.prototype as unknown as LocaleStringHost);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3001/',
  pretendToBeVisual: true,
});

// `navigator` is a read-only getter on Node's global, so plain assignment
// throws; every global here goes through defineProperty for consistency.
const defineGlobal = (name: string, value: unknown) => {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
};

defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('localStorage', dom.window.localStorage);
defineGlobal('sessionStorage', dom.window.sessionStorage);
defineGlobal('Event', dom.window.Event);
defineGlobal('CustomEvent', dom.window.CustomEvent);
defineGlobal('Node', dom.window.Node);
defineGlobal('HTMLElement', dom.window.HTMLElement);
defineGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
defineGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0),
);
defineGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));

// Tells React 18 that `act()` is driving updates, so effects flush
// synchronously and unflushed work is reported instead of silently pending.
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
