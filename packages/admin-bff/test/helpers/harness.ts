// Builds a BFF against the fakes, listening on a random port.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp, cookieNames } from '../../src/app.js';
import { deriveKeys, type GwSession, seal, SessionStore, type SessionStoreOptions } from '@gatewaze/host-session';
import type { BffConfig } from '../../src/login.js';
import { FakeApi, FakeSupabase, MemoryKeyValue } from './fakes.js';

export const SITE = 'https://admin.example.test';
export const ANON = 'anon-key-public';
export const KEY = Buffer.alloc(32, 7);

export interface Harness {
  app: FastifyInstance;
  base: string;
  supabase: FakeSupabase;
  api: FakeApi;
  kv: MemoryKeyValue;
  store: SessionStore;
  cfg: BffConfig;
  cookie: string;
  // Stores a session for a fake user and returns the Cookie header for it.
  signIn(userId: string, opts?: { ttlSeconds?: number; isAdmin?: boolean }): Promise<{ cookie: string; sid: string; session: GwSession }>;
  // __ts overrides the cookie's encoded issue time (seconds since the epoch).
  cookieFor(sid: string, ts?: number): string;
  // Overwrites a stored session as the store would write it (encrypted).
  putStored(sid: string, value: unknown): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(
  opts: {
    site?: string;
    logger?: FastifyServerOptions['logger'];
    store?: SessionStoreOptions;
    timeoutMs?: number;
    cfg?: Partial<BffConfig>;
    // 'default' leaves the app's own default (30) in place.
    signInRateLimit?: number | 'default';
    trustProxy?: string;
  } = {},
): Promise<Harness> {
  const supabase = await new FakeSupabase().start();
  const api = await new FakeApi().start();
  const site = opts.site ?? SITE;
  const cfg: BffConfig = {
    supabaseUrl: supabase.url,
    // The browser-facing Supabase origin differs from the internal one, as in
    // a self-hosted deployment.
    publicSupabaseUrl: 'https://supabase.example.test',
    anonKey: ANON,
    siteUrl: site,
    provider: 'custom:lfid',
    ...opts.cfg,
  };
  const kv = new MemoryKeyValue();
  // Encrypted records, as in production (server.ts derives the same keys).
  const storeKeys = deriveKeys([KEY], 'store');
  const store = new SessionStore(cfg, kv, { ttlSeconds: 3600, keys: storeKeys, ...opts.store });
  await store.start();
  const app = await buildApp({
    cfg,
    apiUrl: api.url,
    store,
    sessionKeys: [KEY],
    sessionTtlSeconds: 3600,
    upstreamTimeoutMs: opts.timeoutMs ?? 5000,
    // High by default so ordinary tests never hit it.
    signInRateLimit: opts.signInRateLimit === 'default' ? undefined : (opts.signInRateLimit ?? 10_000),
    trustProxy: opts.trustProxy,
    logger: opts.logger,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const names = cookieNames(site);

  const cookieFor = (sid: string, ts?: number) =>
    `${names.session}=${encodeURIComponent(
      app.encodeSecureSession(app.createSecureSession(ts === undefined ? { sid } : { sid, __ts: ts }), 'session'),
    )}`;

  return {
    app,
    base,
    supabase,
    api,
    kv,
    store,
    cfg,
    cookie: names.session,
    cookieFor,
    async putStored(sid, value) {
      await kv.set(`gw:admin-bff:session:${sid}`, seal(storeKeys, JSON.stringify(value), sid), 3600);
    },
    async signIn(userId, o = {}) {
      const t = supabase.issue(userId, o.ttlSeconds);
      const session: GwSession = {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: t.expires_at,
        user_id: userId,
        is_admin: o.isAdmin ?? supabase.users.get(userId)?.admin ?? false,
      };
      const sid = await store.create(session);
      return { cookie: cookieFor(sid), sid, session };
    },
    async close() {
      await app.close();
      await supabase.stop();
      await api.stop();
    },
  };
}
