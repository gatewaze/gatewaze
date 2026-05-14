/**
 * Empty stub for `undici`. The admin bundle has a transitive dep
 * (likely via supabase-js's auth-helpers or one of the gatewaze-modules)
 * that drags in undici — a Node-only HTTP client that the browser can't
 * run. The actual code paths that need an HTTP client in the admin use
 * `fetch` directly; undici is dead weight pulled in by a tree-shaking
 * miss.
 *
 * Aliased in vite.config.ts: `'undici': './stubs/undici-empty.ts'`.
 *
 * Every export is a no-op or empty class so any import shape resolves:
 *   import { fetch, Agent, request } from 'undici'  ← named imports
 *   import undici from 'undici'                       ← default
 *   import * as u from 'undici'                       ← namespace
 *
 * Calls into these stubs at runtime are theoretical — the bundled code
 * paths in admin never invoke them — but throwing-on-call would surface
 * the underlying tree-shaking issue without breaking the user.
 */

const notImplemented = () => {
  throw new Error(
    '[admin] undici is stubbed in the browser bundle. The platform admin should not call it directly. Use the global fetch().',
  );
};

class StubAgent {
  destroy() {}
  close() {}
}

export const fetch = notImplemented;
export const request = notImplemented;
export const stream = notImplemented;
export const pipeline = notImplemented;
export const connect = notImplemented;
export const upgrade = notImplemented;
export const Agent = StubAgent;
export const Dispatcher = StubAgent;
export const Pool = StubAgent;
export const Client = StubAgent;
export const BalancedPool = StubAgent;
export const ProxyAgent = StubAgent;
export const setGlobalDispatcher = () => {};
export const getGlobalDispatcher = () => new StubAgent();
export const Headers = globalThis.Headers ?? class StubHeaders {};
export const Request = globalThis.Request ?? class StubRequest {};
export const Response = globalThis.Response ?? class StubResponse {};
export const FormData = globalThis.FormData ?? class StubFormData {};

export default {
  fetch,
  request,
  stream,
  pipeline,
  connect,
  upgrade,
  Agent,
  Dispatcher,
  Pool,
  Client,
  BalancedPool,
  ProxyAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  Headers,
  Request,
  Response,
  FormData,
};
