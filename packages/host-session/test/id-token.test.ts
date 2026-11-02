// signInWithIdToken: GoTrue's id_token grant with plain fetch, the same
// toGwSession work as a PKCE sign-in (admin_profiles read with the user's
// token, pending when it can't be made), and the refused/unavailable split.
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_CHECK_TIMEOUT_MS,
  ADMIN_RECHECK_SECONDS,
  DEFAULT_PROVIDER,
  ID_TOKEN_TIMEOUT_MS,
  IdTokenGrantRefusedError,
  IdTokenGrantUnavailableError,
  MAX_ID_TOKEN_TIMEOUT_MS,
  REFRESH_SKEW_SECONDS,
  SessionUnavailableError,
  type HostSessionConfig,
  identitySubject,
  refreshSession,
  signInWithIdToken,
} from '../src/session.js';
import { CREATE_LOCK_MS, MINT_TIMEOUT_MS } from '../src/store.js';
import { FakeSupabase } from './helpers/fakes.js';

let sb: FakeSupabase;
let cfg: HostSessionConfig;
beforeAll(async () => {
  sb = await new FakeSupabase().start();
  sb.addUser('u-admin', 'admin@example.test', true);
  sb.addUser('u-user', 'user@example.test', false);
  sb.idTokens.set('idt-admin', 'u-admin');
  sb.idTokens.set('idt-user', 'u-user');
  cfg = { supabaseUrl: sb.url, anonKey: 'anon-key' };
});
afterAll(() => sb.stop());
beforeEach(() => {
  sb.requests.length = 0;
  sb.idTokenCalls = 0;
  sb.idTokenMode = 'ok';
  sb.idTokenDelayMs = 0;
  sb.adminStatus = null;
  sb.adminDrop = false;
  sb.idTokenRawBody = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idJwt = (sub: string) => `${b64({ alg: 'RS256' })}.${b64({ sub, iss: 'https://idp.example.test/' })}.c2ln`;

const now = () => Math.floor(Date.now() / 1000);
const grantRequests = () => sb.requests.filter((r) => r.url === '/auth/v1/token?grant_type=id_token');
const adminRequests = () => sb.requests.filter((r) => r.url.startsWith('/rest/v1/admin_profiles'));

describe('signInWithIdToken', () => {
  it('posts the ID token with the default provider and the apikey header, and returns an admin session', async () => {
    const s = await signInWithIdToken(cfg, 'idt-admin');
    expect(s.user_id).toBe('u-admin');
    expect(s.is_admin).toBe(true);
    expect(s.admin_check).toBe('ok');
    expect(s.expires_at).toBeGreaterThan(now() + 3000);
    const [grant] = grantRequests();
    expect(grant.method).toBe('POST');
    expect(JSON.parse(grant.body)).toEqual({ provider: DEFAULT_PROVIDER, id_token: 'idt-admin' });
    expect(DEFAULT_PROVIDER).toBe('custom:lfid');
    expect(grant.headers.apikey).toBe('anon-key');
    expect(grant.headers['content-type']).toBe('application/json');
    expect(grant.headers.authorization).toBeUndefined();
  });

  it('reads admin_profiles with the new user token, not the anon key', async () => {
    const s = await signInWithIdToken(cfg, 'idt-admin');
    const [check] = adminRequests();
    expect(check.headers.authorization).toBe(`Bearer ${s.access_token}`);
    expect(check.url).toContain('user_id=eq.u-admin');
  });

  it('uses the configured provider and passes a nonce through', async () => {
    await signInWithIdToken({ ...cfg, provider: 'custom:other' }, 'idt-admin', { nonce: 'n-1' });
    expect(JSON.parse(grantRequests()[0].body)).toEqual({ provider: 'custom:other', id_token: 'idt-admin', nonce: 'n-1' });
  });

  it('returns a definite non-admin for a user without an active admin_profiles row', async () => {
    const s = await signInWithIdToken(cfg, 'idt-user');
    expect(s.is_admin).toBe(false);
    expect(s.admin_check).toBe('ok');
  });

  for (const [label, setup] of [
    ['a 500', () => (sb.adminStatus = 500)],
    ['a dropped connection', () => (sb.adminDrop = true)],
  ] as const) {
    it(`keeps the tokens but marks the admin check pending on ${label} from admin_profiles`, async () => {
      setup();
      const s = await signInWithIdToken(cfg, 'idt-admin');
      expect(s.access_token).toBeTruthy();
      expect(s.is_admin).toBe(false);
      expect(s.admin_check).toBe('pending');
      // Expires soon, so the next request refreshes and repeats the check.
      expect(s.expires_at).toBeLessThanOrEqual(now() + REFRESH_SKEW_SECONDS + ADMIN_RECHECK_SECONDS + 1);
    });
  }

  for (const status of [400, 401, 403, 404, 422]) {
    it(`throws IdTokenGrantRefusedError on a ${status}`, async () => {
      sb.idTokenMode = status;
      const e = await signInWithIdToken(cfg, 'idt-admin').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(IdTokenGrantRefusedError);
      expect(e).not.toBeInstanceOf(SessionUnavailableError);
      expect((e as IdTokenGrantRefusedError).status).toBe(status);
      expect(adminRequests()).toHaveLength(0);
    });
  }

  it('treats an unknown ID token (GoTrue 400) as refused', async () => {
    await expect(signInWithIdToken(cfg, 'idt-unknown')).rejects.toBeInstanceOf(IdTokenGrantRefusedError);
  });

  for (const status of [500, 502, 503, 408, 429]) {
    it(`throws IdTokenGrantUnavailableError on a ${status}`, async () => {
      sb.idTokenMode = status;
      const e = await signInWithIdToken(cfg, 'idt-admin').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(IdTokenGrantUnavailableError);
      expect(e).toBeInstanceOf(SessionUnavailableError);
      expect(e).not.toBeInstanceOf(IdTokenGrantRefusedError);
    });
  }

  it('throws IdTokenGrantUnavailableError when GoTrue cannot be reached', async () => {
    // A port that was free a moment ago: connection refused.
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as AddressInfo).port;
    await new Promise((r) => srv.close(r));
    await expect(signInWithIdToken({ ...cfg, supabaseUrl: `http://127.0.0.1:${port}` }, 'idt-admin')).rejects.toBeInstanceOf(
      IdTokenGrantUnavailableError,
    );
  });

  it('gives up within its timeout when GoTrue hangs', async () => {
    sb.idTokenDelayMs = 2000;
    const started = Date.now();
    await expect(signInWithIdToken(cfg, 'idt-admin', { timeoutMs: 150 })).rejects.toBeInstanceOf(IdTokenGrantUnavailableError);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('bounds the grant by default, and the create lock outlasts a three-call mint', () => {
    expect(ID_TOKEN_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(ADMIN_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(CREATE_LOCK_MS).toBeGreaterThan(30_000);
    expect(MAX_ID_TOKEN_TIMEOUT_MS + ADMIN_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(MINT_TIMEOUT_MS);
  });

  for (const [label, given, expected] of [
    ['no timeoutMs', undefined, ID_TOKEN_TIMEOUT_MS],
    ['a timeoutMs past the cap', 60_000, MAX_ID_TOKEN_TIMEOUT_MS],
    ['a zero timeoutMs', 0, ID_TOKEN_TIMEOUT_MS],
    ['a NaN timeoutMs', Number.NaN, ID_TOKEN_TIMEOUT_MS],
    ['a short timeoutMs', 1234, 1234],
  ] as const) {
    it(`bounds the grant call at ${expected} ms for ${label}`, async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      await signInWithIdToken(cfg, 'idt-admin', given === undefined ? {} : { timeoutMs: given });
      // The first bounded call is the grant; the second is admin_profiles.
      expect(timeout.mock.calls[0]?.[0]).toBe(expected);
    });
  }

  for (const [label, body] of [
    ['an empty object', '{}'],
    ['a non-JSON body', 'not json'],
    ['tokens without a user', JSON.stringify({ access_token: 'a', refresh_token: 'r' })],
    ['non-string tokens', JSON.stringify({ access_token: 1, refresh_token: 2, user: { id: 'u' } })],
  ] as const) {
    it(`treats a 200 with ${label} as unavailable`, async () => {
      sb.idTokenRawBody = body;
      await expect(signInWithIdToken(cfg, 'idt-admin')).rejects.toBeInstanceOf(IdTokenGrantUnavailableError);
    });
  }

  it('ignores a non-numeric expires_at and uses expires_in instead', async () => {
    sb.idTokenRawBody = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 'soon', expires_in: 1800, user: { id: 'u' } });
    const s = await signInWithIdToken(cfg, 'idt-admin');
    expect(Math.abs(s.expires_at - (now() + 1800))).toBeLessThanOrEqual(2);
  });

  it('falls back to a short default expiry when neither is a number', async () => {
    sb.idTokenRawBody = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 'soon', expires_in: '1800', user: { id: 'u' } });
    const s = await signInWithIdToken(cfg, 'idt-admin');
    expect(s.expires_at).toBeLessThanOrEqual(now() + 301);
  });

  it('records the ID token subject on the session', async () => {
    const token = idJwt('idp|alice');
    sb.idTokens.set(token, 'u-admin');
    const s = await signInWithIdToken(cfg, token);
    expect(s.sub).toBe('idp|alice');
  });

  it('keeps the recorded subject across a refresh', async () => {
    const t = sb.issue('u-admin');
    const s = await refreshSession(cfg, { ...t, user_id: 'u-admin', is_admin: true, admin_check: 'ok', sub: 'idp|alice' });
    expect(s.sub).toBe('idp|alice');
  });
});

describe('identitySubject', () => {
  it('reads the identity for the provider, then its id, then user_metadata.sub', () => {
    const identities = [
      { provider: 'github', id: 'gh-1', identity_data: { sub: 'gh-sub' } },
      { provider: 'custom:lfid', id: 'lf-id', identity_data: { sub: 'lf-sub' } },
    ];
    expect(identitySubject({ id: 'u', identities }, 'custom:lfid')).toBe('lf-sub');
    expect(identitySubject({ id: 'u', identities: [{ provider: 'custom:lfid', id: 'lf-id', identity_data: {} }] }, 'custom:lfid')).toBe('lf-id');
    expect(identitySubject({ id: 'u', identities: [], user_metadata: { sub: 'meta-sub' } }, 'custom:lfid')).toBe('meta-sub');
    expect(identitySubject({ id: 'u' }, 'custom:lfid')).toBeUndefined();
  });
});
