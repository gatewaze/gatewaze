// @gatewaze/host-session: the framework-free core of a host-session session
// holder. GoTrue session handling (sign-in with an ID token, refresh, the
// admin_profiles check), the encrypted session store, request rewriting and
// CSRF rules, the HTTP proxy and the Realtime bridge. A host wraps these
// with a thin adapter for its own HTTP framework: the Gatewaze admin BFF
// (packages/admin-bff) does it for Fastify, LFX One for Express.
export * from './host-session.js';
export * from './keys.js';
export * from './session.js';
export * from './store.js';
export * from './proxy.js';
export { type RealtimeBridge, type RealtimeBridgeOptions, bridgeRealtime } from './realtime.js';
