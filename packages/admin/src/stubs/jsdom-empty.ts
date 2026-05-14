/**
 * Empty stub for `jsdom`. The browser already has a DOM — jsdom is
 * for Node environments. It's pulled into the admin bundle via
 * isomorphic-dompurify's Node code path (the lib defaults to jsdom
 * on Node and the real browser DOM on browser, but somehow both
 * branches are bundled).
 *
 * Aliased in vite.config.ts: `'jsdom': './stubs/jsdom-empty.ts'`.
 *
 * jsdom's exports we care about for the import shape:
 *   JSDOM, VirtualConsole, CookieJar, ResourceLoader, FromUrlOptions,
 *   FromFileOptions, BaseOptions, ConstructorOptions
 *
 * Every export is a no-op class or stub function. Calls into these
 * stubs throw — the admin should never legitimately invoke jsdom at
 * runtime (the browser's native DOM is always available).
 */

const notImplemented = (name: string) => () => {
  throw new Error(
    `[admin] jsdom.${name} is stubbed in the browser bundle. The admin should not call jsdom directly; use the native DOM.`,
  );
};

class StubJSDOM {
  static fromURL = notImplemented('JSDOM.fromURL');
  static fromFile = notImplemented('JSDOM.fromFile');
  static fragment = notImplemented('JSDOM.fragment');
  window = {};
  serialize() { return ''; }
  nodeLocation() { return null; }
  getInternalVMContext() { return {}; }
  reconfigure() {}
}

// Extends the global EventTarget so consumers that do
// `new VirtualConsole().on(...)` get *something* listener-shaped back
// — the platform's gatewaze-modules vite plugin stubs `node:events` to
// an empty object, so jsdom's internal `EventEmitter` extends fails.
// Extending EventTarget is close enough for the on/off shape (and
// nothing in the admin actually subscribes to jsdom's events).
class StubVirtualConsole extends EventTarget {
   
  on(_event: string, _handler: (...args: any[]) => void) { return this; }
   
  off(_event: string, _handler: (...args: any[]) => void) { return this; }
   
  emit(..._args: any[]) { return false; }
  forwardTo() { return this; }
  sendTo() { return this; }
}

class StubCookieJar {
  setCookie() {}
  getCookie() {}
  getCookies() { return []; }
  getCookieString() { return ''; }
}

class StubResourceLoader {
  fetch() { return Promise.resolve(null); }
}

export const JSDOM = StubJSDOM;
export const VirtualConsole = StubVirtualConsole;
export const CookieJar = StubCookieJar;
export const ResourceLoader = StubResourceLoader;
export const toughCookie = { CookieJar: StubCookieJar };

export default {
  JSDOM: StubJSDOM,
  VirtualConsole: StubVirtualConsole,
  CookieJar: StubCookieJar,
  ResourceLoader: StubResourceLoader,
  toughCookie: { CookieJar: StubCookieJar },
};
