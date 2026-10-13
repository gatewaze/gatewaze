// Turns the validated environment into the options server.ts passes to
// buildApp and SessionStore.connect. Kept free of side effects so a test can
// check the wiring without starting a server or connecting to Redis.
import { type AppOptions, loggerOptions } from './app.js';
import type { BffEnv } from './config.js';
import { type SessionStore, type SessionStoreOptions, deriveKeys } from '@gatewaze/host-session';

export function storeOptionsFromEnv(env: BffEnv): SessionStoreOptions & { keys: Buffer[] } {
  return { ttlSeconds: env.sessionTtlSeconds, keys: deriveKeys(env.sessionKeys, 'store') };
}

export function appOptionsFromEnv(env: BffEnv, store: SessionStore): AppOptions {
  return {
    cfg: env.cfg,
    apiUrl: env.apiUrl,
    store,
    sessionKeys: env.sessionKeys,
    sessionTtlSeconds: env.sessionTtlSeconds,
    upstreamTimeoutMs: env.upstreamTimeoutMs,
    trustProxy: env.trustProxy,
    signInRateLimit: env.signInRateLimit,
    logger: loggerOptions(env.logLevel),
  };
}
