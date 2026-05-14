/**
 * Browser polyfills for Node-targeted libraries that end up bundled
 * into the admin app.
 *
 * This file is imported FIRST in main.tsx (above every other import).
 * That ordering is load-bearing: ES module evaluation runs imports
 * depth-first BEFORE the importer's body, so polyfill code embedded in
 * main.tsx's body runs AFTER vendor chunks have already evaluated their
 * top-level code. Previous attempts (1.2.19 / 1.2.20) put the polyfill
 * in main.tsx's body — the Proxy was in place by the time React
 * components rendered, but some libs had already captured
 * `process.env.X` (undefined) at their own module init, and the
 * captured value was what later crashed in `.split(...)`.
 *
 * This file imports nothing, so when main.tsx does `import './polyfills'`
 * before any other import, the polyfill is the very first thing to
 * evaluate in the entire app — every other module sees a populated
 * `globalThis.process` from then on.
 */

// `process` polyfill — some libraries bundled into admin (event-invites
// WASM/PDF stack, isomorphic dompurify, etc.) reference `process.env.X`
// directly without a `typeof` guard.
//
// `process.env` is wrapped in a Proxy that returns '' (empty string)
// for any missing key. Plain object with only NODE_ENV set caused libs
// that did `process.env.SOMETHING.split('/')` to throw `Cannot read
// properties of undefined (reading 'split')`. Empty string supports
// every string method (`.split`, `.length`, `.indexOf`, etc.) and is
// the closest semantic match to "env var not set" — which is what
// isomorphic libs are usually branching on anyway.
if (typeof (globalThis as { process?: unknown }).process === 'undefined') {
  const envBase: Record<string, string> = { NODE_ENV: 'production' };
  const envProxy = new Proxy(envBase, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      return key in target ? target[key] : '';
    },
  });
   
  (globalThis as any).process = {
    env: envProxy,
    platform: 'browser',
    // version + versions.node populated as parseable semver strings —
    // undici (Node HTTP client, bundled into the admin via a transitive
    // dep on one of the modules) reads them at module init with
    // `process.versions.node.split('.', 2).map(Number)`. Empty
    // `versions: {}` made `.node` undefined and the `.split` crashed
    // the event-invites tab. A valid version string is enough to
    // satisfy undici's version parser; the bundled path never actually
    // performs network I/O from the browser anyway — it's pulled in
    // via tree-shaking failure, not because anyone calls it.
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    browser: true,
    nextTick: (cb: () => void) => setTimeout(cb, 0),
  };
}

// SharedArrayBuffer is provided by the nginx COOP+COEP-credentialless
// headers — no JS polyfill needed. The HTTP-layer fix is in
// docker/admin/nginx.conf.
