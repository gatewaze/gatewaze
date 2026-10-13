// Framework-free core of the admin BFF: GoTrue session handling, the session
// store, request rewriting and CSRF rules, and the Realtime bridge. A host
// with its own HTTP framework (LFX One's Express server, for example) can
// wrap these with a thin adapter, as src/app.ts does for Fastify.
export * from './host-session.js';
export * from './keys.js';
export * from './session.js';
export * from './store.js';
export {
  type ProxyCredentials,
  type ProxyOptions,
  type ProxyResult,
  type Upstream,
  UpstreamPathError,
  forwardedFor,
  proxyRequest,
  realtimeUpstreamUrl,
  rejectUpgrade,
  upstreamHeaders,
  upstreamUrl,
} from './proxy.js';
export { type RealtimeBridge, type RealtimeBridgeOptions, bridgeRealtime } from './realtime.js';
