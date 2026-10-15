import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// ── Fakes ──────────────────────────────────────────────────────────────────

const store = new Map<string, string>();
const fakeRedis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return 'OK';
  }),
  getdel: vi.fn(async (k: string) => {
    const v = store.get(k) ?? null;
    store.delete(k);
    return v;
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const k of keys) store.delete(k);
    return keys.length;
  }),
};
vi.mock('../../lib/queue/index.js', () => ({ getRedisConnection: () => fakeRedis }));

let moduleRow: { status: string; config: Record<string, string> } | null = null;
const rpc = vi.fn();
const sessionsInsert = vi.fn();
const getUser = vi.fn();
const adminSignOut = vi.fn();
const supabase = {
  auth: { getUser, admin: { signOut: adminSignOut } },
  from: (table: string) => {
    if (table === 'installed_modules') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: moduleRow, error: null }) }) }) };
    }
    if (table === 'mcp_sessions') {
      return {
        insert: (row: unknown) => {
          sessionsInsert(row);
          return { select: () => ({ single: async () => ({ data: { id: 's1' }, error: null }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  },
  rpc: (name: string) => ({ abortSignal: () => rpc(name) }),
};
vi.mock('../../lib/supabase.js', () => ({ getSupabase: () => supabase }));

// Records which routes run which per-IP rate limiter. A bucket in `exhausted`
// answers 429 the way the real limiter does.
const rateLimited: string[] = [];
const exhausted = new Set<string>();
vi.mock('../../lib/rate-limiter.js', () => ({
  ipRateLimiter: (config: { bucket: string }) =>
    (req: { path: string }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      rateLimited.push(`${config.bucket} ${req.path}`);
      if (exhausted.has(config.bucket)) {
        res.status(429).json({ error: { code: 'rate_limited', message: 'Rate limit exceeded.' } });
        return;
      }
      next();
    },
}));

// The magic-link routes make their own anon client.
const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
vi.mock('@supabase/supabase-js', async (orig) => ({
  ...(await orig<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
}));

const ensureAuthAndPerson = vi.fn();
vi.mock('../../lib/mcp-auth/provision.js', () => ({ ensureAuthAndPerson }));
const resolveAccess = vi.fn();
vi.mock('../../lib/mcp-auth/scopes.js', () => ({ resolveAccess }));

const startNativeLfid = vi.fn();
const finishNativeLfid = vi.fn();
vi.mock('../../lib/mcp-auth/lfid-native.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/mcp-auth/lfid-native.js')>()),
  startNativeLfid,
  finishNativeLfid,
}));

const { mcpAuthRouter } = await import('../mcp-auth.js');
const { NativeLfidRefused } = await import('../../lib/mcp-auth/lfid-native.js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mcpAuthRouter);

// ── Helpers ────────────────────────────────────────────────────────────────

const API = 'https://api.example.test';
const CLIENT_ID = 'dcr_testclient';
const REDIRECT_URI = 'https://client.example.test/cb';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const GOTRUE_URL = 'https://sb.example.test/auth/v1/authorize?provider=custom%3Alfid&code_challenge=x&code_challenge_method=s256';

function seedClient(name = 'Test Client') {
  store.set(`mcp:client:${CLIENT_ID}`, JSON.stringify({ client_name: name, redirect_uris: [REDIRECT_URI] }));
}

function authorize() {
  return request(app).get('/api/mcp-auth/authorize').query({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st-1',
  });
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/** Runs /authorize in native mode; returns the request id and the cookie. */
async function startNative() {
  const res = await authorize();
  expect(res.status).toBe(200);
  const reqId = must(/name="req_id" value="([^"]+)"/.exec(res.text), 'req_id')[1];
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = must(setCookie.find((c) => c.startsWith(`gw_mcp_lfid_${reqId}=`)), 'cookie').split(';')[0];
  return { res, reqId, cookie, setCookie: setCookie.join('\n') };
}

const BRIDGE_MODULE = { status: 'enabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
const BRIDGE_START = 'https://sb.example.test/functions/v1/integrations-lfid-callback';

/** Runs /authorize in bridge mode; returns the request id and the cookie. */
async function startBridge() {
  const res = await authorize();
  expect(res.status).toBe(200);
  const reqId = must(/name="req_id" value="([^"]+)"/.exec(res.text), 'req_id')[1];
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = must(setCookie.find((c) => c.startsWith(`gw_mcp_bridge_${reqId}=`)), 'cookie').split(';')[0];
  return { res, reqId, cookie, setCookie: setCookie.join('\n') };
}

function bridgeStart(reqId: string, cookie: string | null) {
  const r = request(app).post('/api/mcp-auth/bridge/start').type('form').send({ req_id: reqId });
  return cookie ? r.set('Cookie', cookie) : r;
}

/** Runs /authorize and /bridge/start in bridge mode. */
async function startedBridge() {
  const started = await startBridge();
  const res = await bridgeStart(started.reqId, started.cookie);
  expect(res.status).toBe(303);
  return { ...started, location: res.headers.location as string };
}

function bridgeComplete(reqId: string, cookie: string | null, accessToken = 'bridge-session') {
  const r = request(app).post('/api/mcp-auth/bridge/complete').send({ req_id: reqId, access_token: accessToken });
  return cookie ? r.set('Cookie', cookie) : r;
}

/** Runs /authorize and /lfid/start in native mode. */
async function startedNative() {
  const started = await startNative();
  const res = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', started.cookie).type('form').send({ req_id: started.reqId });
  expect(res.status).toBe(303);
  return started;
}

function callback(reqId: string, cookie: string | null, query: Record<string, string | string[]> = { code: 'gotrue-code' }) {
  const r = request(app).get(`/api/mcp-auth/lfid/callback/${reqId}`).query(query);
  return cookie ? r.set('Cookie', cookie) : r;
}

/** The request id /authorize stored, for modes that do not show it in a cookie. */
function lastAuthReqId(): string {
  const key = must([...store.keys()].find((k) => k.startsWith('mcp:authreq:')), 'authreq');
  return key.slice('mcp:authreq:'.length);
}

function grantFrom(location: string) {
  const code = must(new URL(location).searchParams.get('code'), 'code');
  return JSON.parse(must(store.get(`mcp:code:${code}`), 'grant')) as Record<string, unknown>;
}

beforeEach(() => {
  store.clear();
  exhausted.clear();
  vi.clearAllMocks();
  moduleRow = null;
  rpc.mockResolvedValue({ data: 'bridge', error: null });
  adminSignOut.mockResolvedValue({ data: null, error: null });
  getUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'bob@example.test', user_metadata: { lfid_sub: 'auth0|bob' } } }, error: null });
  ensureAuthAndPerson.mockResolvedValue({ personId: 'p1', authUserId: 'u1', created: false });
  resolveAccess.mockResolvedValue({ scopes: ['events:read'], groups: [{ name: 'member' }] });
  startNativeLfid.mockResolvedValue({ url: GOTRUE_URL, pkce: { 'sb-x-auth-token-code-verifier': 'pkce-verifier' } });
  finishNativeLfid.mockResolvedValue({ authUserId: 'u1', email: 'ada@example.test', lfidSub: 'auth0|ada', displayName: 'Ada' });
  vi.stubEnv('API_URL', API);
  vi.stubEnv('SUPABASE_URL', 'https://sb.example.test');
  vi.stubEnv('SUPABASE_PUBLIC_URL', 'https://sb.example.test');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('LFID_SIGN_IN_MODE', '');
  vi.stubEnv('MCP_TOKEN_SECRET', 'test-mcp-secret');
  vi.stubEnv('PUBLIC_MCP_URL', 'https://mcp.example.test');
  seedClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Mode selection ─────────────────────────────────────────────────────────

describe('/authorize login mode', () => {
  it('uses magic link when lfid-auth is not installed, without asking for the LFID mode', async () => {
    const res = await authorize();
    expect(res.status).toBe(200);
    expect(res.text).toContain('/api/mcp-auth/magic/start');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses magic link when lfid-auth is installed but disabled, even with the native env key', async () => {
    moduleRow = { status: 'disabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const res = await authorize();
    expect(res.text).toContain('/api/mcp-auth/magic/start');
  });

  it('asks a bridge install to confirm the client before going to the bridge', async () => {
    moduleRow = BRIDGE_MODULE;
    const { res, setCookie } = await startBridge();
    expect(res.text).toContain('Continue with LFID');
    expect(res.text).toContain('action="/api/mcp-auth/bridge/start"');
    expect(res.text).toContain('Test Client');
    expect(res.text).toContain('client.example.test');
    expect(res.text).not.toContain('integrations-lfid-callback');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/Path=\/api\/mcp-auth\/bridge/);
    expect(setCookie).toMatch(/Max-Age=900/);
    expect(rpc).toHaveBeenCalledWith('lfid_sign_in_mode');
  });

  it('keeps the bridge when the mode lookup fails', async () => {
    moduleRow = BRIDGE_MODULE;
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    const { res } = await startBridge();
    expect(res.text).toContain('action="/api/mcp-auth/bridge/start"');
  });

  it('falls back to magic link on a bridge install without Auth0 config, as before', async () => {
    moduleRow = { status: 'enabled', config: {} };
    const res = await authorize();
    expect(res.text).toContain('/api/mcp-auth/magic/start');
  });

  it('goes native when the API environment marks a native-deploy install, without the lookup', async () => {
    moduleRow = { status: 'enabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const { res, setCookie } = await startNative();
    expect(res.text).toContain('Continue with LFID');
    expect(res.text).toContain('action="/api/mcp-auth/lfid/start"');
    expect(res.text).toContain('client.example.test');
    expect(res.text).not.toContain('integrations-lfid-callback');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/Path=\/api\/mcp-auth\/lfid/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('goes native when lfid_sign_in_mode() says native, with no Auth0 keys needed', async () => {
    moduleRow = { status: 'enabled', config: {} };
    rpc.mockResolvedValue({ data: 'native', error: null });
    const { res } = await startNative();
    expect(res.text).toContain('Continue with LFID');
  });

  it('answers 503 in native mode when the API has no Supabase anon config', async () => {
    moduleRow = { status: 'enabled', config: {} };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const res = await authorize();
    expect(res.status).toBe(503);
  });
});

// ── Native flow ────────────────────────────────────────────────────────────

describe('native LFID flow', () => {
  beforeEach(() => {
    moduleRow = { status: 'enabled', config: {} };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
  });

  it('rate limits /lfid/start and the callback per client IP', async () => {
    rateLimited.length = 0;
    const { reqId, cookie } = await startedNative();
    await callback(reqId, cookie);
    expect(rateLimited.filter((r) => r.startsWith('mcp-auth-lfid '))).toEqual([
      'mcp-auth-lfid /api/mcp-auth/lfid/start',
      `mcp-auth-lfid /api/mcp-auth/lfid/callback/${reqId}`,
    ]);
  });

  it('sets a request cookie that lasts as long as the request', async () => {
    const { setCookie } = await startNative();
    expect(setCookie).toMatch(/Max-Age=900/);
  });

  it('starts GoTrue PKCE only for the browser holding the request cookie', async () => {
    const { reqId, cookie } = await startNative();

    const noCookie = await request(app).post('/api/mcp-auth/lfid/start').type('form').send({ req_id: reqId });
    expect(noCookie.status).toBe(400);
    const wrong = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', `gw_mcp_lfid_${reqId}=nope`).type('form').send({ req_id: reqId });
    expect(wrong.status).toBe(400);
    expect(startNativeLfid).not.toHaveBeenCalled();

    const ok = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', cookie).type('form').send({ req_id: reqId });
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe(GOTRUE_URL);
    expect(startNativeLfid).toHaveBeenCalledWith(expect.objectContaining({ anonKey: 'anon' }), `${API}/api/mcp-auth/lfid/callback/${reqId}`);
    expect(JSON.parse(must(store.get(`mcp:lfidreq:${reqId}`), 'lfidreq')).pkce).toEqual({ 'sb-x-auth-token-code-verifier': 'pkce-verifier' });
  });

  it('will not start for an MCP request that has expired', async () => {
    const { reqId, cookie } = await startNative();
    store.delete(`mcp:authreq:${reqId}`);
    const res = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', cookie).type('form').send({ req_id: reqId });
    expect(res.status).toBe(400);
    expect(startNativeLfid).not.toHaveBeenCalled();
  });

  it('answers 503 from /lfid/start when the Supabase config has gone', async () => {
    const { reqId, cookie } = await startNative();
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    const res = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', cookie).type('form').send({ req_id: reqId });
    expect(res.status).toBe(503);
  });

  it('answers 500, not 502, when Redis fails at /lfid/start', async () => {
    const { reqId, cookie } = await startNative();
    fakeRedis.set.mockRejectedValueOnce(new Error('redis down'));
    const res = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', cookie).type('form').send({ req_id: reqId });
    expect(res.status).toBe(500);
  });

  it('answers 502 when GoTrue cannot start the flow', async () => {
    startNativeLfid.mockRejectedValue(new Error('provider not found'));
    const { reqId, cookie } = await startNative();
    const res = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', cookie).type('form').send({ req_id: reqId });
    expect(res.status).toBe(502);
  });

  it('exchanges the code, completes the MCP grant and issues tokens', async () => {
    const { reqId, cookie } = await startedNative();

    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(302);
    expect(finishNativeLfid).toHaveBeenCalledWith(expect.anything(), 'gotrue-code', { 'sb-x-auth-token-code-verifier': 'pkce-verifier' });
    expect(ensureAuthAndPerson).toHaveBeenCalledWith(supabase, {
      email: 'ada@example.test', authUserId: 'u1', lfidSub: 'auth0|ada', displayName: 'Ada',
    });
    expect(String(cb.headers['set-cookie'])).toMatch(new RegExp(`gw_mcp_lfid_${reqId}=;`));
    expect(fakeRedis.getdel).toHaveBeenCalledWith(`mcp:lfidreq:${reqId}`);

    const back = new URL(cb.headers.location);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT_URI);
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('iss')).toBe(API);
    const grantCode = must(back.searchParams.get('code'), 'code');
    expect(grantFrom(cb.headers.location)).toMatchObject({ subject: 'auth0|ada', email: 'ada@example.test', authMode: 'lfid', personId: 'p1' });
    for (const k of ['authreq', 'lfidreq', 'magicreq']) expect(store.has(`mcp:${k}:${reqId}`)).toBe(false);

    const tok = await request(app).post('/api/mcp-auth/token').send({
      grant_type: 'authorization_code', code: grantCode, code_verifier: VERIFIER, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toBeTruthy();
    expect(sessionsInsert).toHaveBeenCalledWith(expect.objectContaining({ auth_mode: 'lfid', subject: 'auth0|ada' }));

    // The verifier was single use.
    const again = await callback(reqId, cookie);
    expect(again.status).toBe(400);
    expect(finishNativeLfid).toHaveBeenCalledTimes(1);
  });

  // Another callback for the same request took the verifier between this
  // one's read and its GETDEL (null), or /lfid/start rewrote it (a different value).
  it.each([['nothing', null], ['a different value', JSON.stringify({ binding: 'x', pkce: {} })]])(
    'refuses a callback whose GETDEL returns %s, without exchanging the code',
    async (_label, value) => {
      const { reqId, cookie } = await startedNative();
      fakeRedis.getdel.mockResolvedValueOnce(value);
      const cb = await callback(reqId, cookie);
      expect(cb.status).toBe(400);
      expect(finishNativeLfid).not.toHaveBeenCalled();
      expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
    },
  );

  it('uses the Gatewaze user id as subject when the identity has no LFID sub', async () => {
    finishNativeLfid.mockResolvedValue({ authUserId: 'u9', email: 'x@example.test' });
    const { reqId, cookie } = await startedNative();
    const cb = await callback(reqId, cookie, { code: 'c' });
    expect(grantFrom(cb.headers.location).subject).toBe('u9');
  });

  it('refuses a callback without the cookie, leaving the request for its owner', async () => {
    const { reqId } = await startedNative();
    const cb = await callback(reqId, null);
    expect(cb.status).toBe(400);
    expect(finishNativeLfid).not.toHaveBeenCalled();
    expect(store.has(`mcp:lfidreq:${reqId}`)).toBe(true);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('refuses a malformed callback request id', async () => {
    const res = await request(app).get('/api/mcp-auth/lfid/callback/short').query({ code: 'c' });
    expect(res.status).toBe(400);
  });

  // Every way a bound callback fails uses up the request, so a request id
  // that reached a log cannot be retried.
  async function expectUsedUp(reqId: string, cookie: string) {
    expect(store.has(`mcp:lfidreq:${reqId}`)).toBe(false);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
    const retry = await callback(reqId, cookie);
    expect(retry.status).toBe(400);
  }

  it('refuses and uses up a callback that skipped /lfid/start', async () => {
    const { reqId, cookie } = await startNative();
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(400);
    expect(finishNativeLfid).not.toHaveBeenCalled();
    await expectUsedUp(reqId, cookie);
  });

  it('refuses a callback whose MCP request has expired, without exchanging the code', async () => {
    const { reqId, cookie } = await startedNative();
    store.delete(`mcp:authreq:${reqId}`);
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(400);
    expect(finishNativeLfid).not.toHaveBeenCalled();
    await expectUsedUp(reqId, cookie);
  });

  it.each([
    ['an error', { error: 'access_denied', error_description: 'Call 555-EVIL to unlock' }],
    ['an error alongside a code', { error: 'access_denied', code: 'c' }],
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a repeated code', { code: ['a', 'b'] }],
  ])('shows a fixed message for %s from GoTrue and uses up the request', async (_label, query) => {
    const { reqId, cookie } = await startedNative();
    const cb = await callback(reqId, cookie, query as Record<string, string | string[]>);
    expect(cb.status).toBe(400);
    expect(cb.text).not.toContain('555-EVIL');
    expect(finishNativeLfid).not.toHaveBeenCalled();
    await expectUsedUp(reqId, cookie);
  });

  it('answers 401 when the sign-in is refused, and uses up the request', async () => {
    finishNativeLfid.mockRejectedValue(new NativeLfidRefused('signed-in user email is not verified'));
    const { reqId, cookie } = await startedNative();
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(401);
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    await expectUsedUp(reqId, cookie);
  });

  it('answers 502 when GoTrue fails or times out, and uses up the request', async () => {
    finishNativeLfid.mockRejectedValue(new Error('GoTrue code exchange failed: The operation was aborted due to timeout'));
    const { reqId, cookie } = await startedNative();
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(502);
    await expectUsedUp(reqId, cookie);
  });

  it('answers 503 from the callback when the Supabase config has gone', async () => {
    const { reqId, cookie } = await startedNative();
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(503);
    expect(finishNativeLfid).not.toHaveBeenCalled();
    await expectUsedUp(reqId, cookie);
  });

  it('answers 500 when completing the MCP grant fails, and uses up the request', async () => {
    ensureAuthAndPerson.mockRejectedValue(new Error('person provisioning failed'));
    const { reqId, cookie } = await startedNative();
    const cb = await callback(reqId, cookie);
    expect(cb.status).toBe(500);
    await expectUsedUp(reqId, cookie);
  });

  it.each(['../x', 'short', 'a'.repeat(65)])('rejects a malformed request id %s at /lfid/start', async (id) => {
    const start = await request(app).post('/api/mcp-auth/lfid/start').type('form').send({ req_id: id });
    expect(start.status).toBe(400);
  });
});

// ── Bridge flow ────────────────────────────────────────────────────────────

describe('bridge LFID flow', () => {
  beforeEach(() => {
    moduleRow = BRIDGE_MODULE;
  });

  it('goes to the bridge only after the user confirms, from the browser holding the cookie', async () => {
    const { reqId, cookie } = await startBridge();

    const noCookie = await bridgeStart(reqId, null);
    expect(noCookie.status).toBe(400);
    const wrong = await bridgeStart(reqId, `gw_mcp_bridge_${reqId}=nope`);
    expect(wrong.status).toBe(400);
    const nativeName = await bridgeStart(reqId, cookie.replace('gw_mcp_bridge_', 'gw_mcp_lfid_'));
    expect(nativeName.status).toBe(400);
    expect(JSON.parse(must(store.get(`mcp:bridgereq:${reqId}`), 'bridgereq')).started).toBeUndefined();

    const ok = await bridgeStart(reqId, cookie);
    expect(ok.status).toBe(303);
    expect(ok.headers['cache-control']).toBe('no-store');
    const loc = new URL(ok.headers.location);
    expect(`${loc.origin}${loc.pathname}`).toBe(BRIDGE_START);
    expect(loc.searchParams.get('action')).toBe('start');
    expect(loc.searchParams.get('return_url')).toBe(`${API}/api/mcp-auth/bridge/return?req_id=${reqId}`);
    expect(JSON.parse(must(store.get(`mcp:bridgereq:${reqId}`), 'bridgereq')).started).toBe(true);
  });

  it('will not start for an MCP request that has expired', async () => {
    const { reqId, cookie } = await startBridge();
    store.delete(`mcp:authreq:${reqId}`);
    const res = await bridgeStart(reqId, cookie);
    expect(res.status).toBe(400);
  });

  it('will not start when the install has left bridge mode since the confirm page', async () => {
    const { reqId, cookie } = await startBridge();
    rpc.mockResolvedValue({ data: 'native', error: null });
    const res = await bridgeStart(reqId, cookie);
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('answers 500 when Redis fails at /bridge/start', async () => {
    const { reqId, cookie } = await startBridge();
    fakeRedis.set.mockRejectedValueOnce(new Error('redis down'));
    const res = await bridgeStart(reqId, cookie);
    expect(res.status).toBe(500);
  });

  it('serves a return page that posts the session to /bridge/complete with the cookie', async () => {
    const { reqId } = await startedBridge();
    const res = await request(app).get('/api/mcp-auth/bridge/return').query({ req_id: reqId });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain("fetch('/api/mcp-auth/bridge/complete'");
    expect(res.text).toContain("credentials: 'same-origin'");
    expect(res.text).toContain("body.redirect.startsWith('https://') || body.redirect.startsWith('http://')");
    expect(res.text).toContain('r.status === 429 ? "Too many sign-in attempts');
    expect(res.text).not.toContain('[object');
    expect(res.text).toContain(JSON.stringify(reqId));
    const bad = await request(app).get('/api/mcp-auth/bridge/return').query({ req_id: '"</script>' });
    expect(bad.status).toBe(400);
  });

  describe('return page script', () => {
    async function runReturnPage(response: { status: number; body: string }) {
      const { reqId } = await startedBridge();
      const page = await request(app).get('/api/mcp-auth/bridge/return').query({ req_id: reqId });
      const script = must(/<script>([\s\S]*)<\/script>/.exec(page.text), 'script')[1];
      const shown = { textContent: '' };
      const replace = vi.fn();
      const fetchStub = vi.fn(async () => new Response(response.body, { status: response.status }));
      runInNewContext(script, {
        window: { location: { hash: '#access_token=tok&expires_in=3600', pathname: '/api/mcp-auth/bridge/return', replace } },
        history: { replaceState: () => undefined },
        document: { querySelector: () => shown },
        fetch: fetchStub,
        URLSearchParams,
      });
      await vi.waitFor(() => {
        if (!shown.textContent && !replace.mock.calls.length) throw new Error('script still running');
      });
      return { shown: shown.textContent, replace, fetchStub, reqId };
    }

    it('posts the token and follows an https redirect', async () => {
      const { replace, fetchStub, reqId } = await runReturnPage({ status: 200, body: JSON.stringify({ redirect: 'https://client.example.test/cb?code=x' }) });
      expect(replace).toHaveBeenCalledWith('https://client.example.test/cb?code=x');
      const [, init] = fetchStub.mock.calls[0] as unknown as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual({ req_id: reqId, access_token: 'tok' });
    });

    it('shows a readable message for an HTML 429', async () => {
      const { shown, replace } = await runReturnPage({ status: 429, body: '<html>Too Many Requests</html>' });
      expect(shown).toBe('Sign-in failed. Too many sign-in attempts from this network. Wait a few minutes, then start again from your client.');
      expect(replace).not.toHaveBeenCalled();
    });

    it('shows a readable message for a 200 that is not JSON', async () => {
      const { shown, replace } = await runReturnPage({ status: 200, body: 'not json' });
      expect(shown).toBe('Sign-in failed. Start again from your client.');
      expect(replace).not.toHaveBeenCalled();
    });

    it('will not follow a redirect that is not a web URL', async () => {
      const { shown, replace } = await runReturnPage({ status: 200, body: JSON.stringify({ redirect: 'javascript:alert(1)//' }) });
      expect(replace).not.toHaveBeenCalled();
      expect(shown).toBe('Sign-in failed. Start again from your client.');
    });

    it('shows the server message for a refused completion', async () => {
      const { shown } = await runReturnPage({ status: 400, body: JSON.stringify({ error: 'expired', error_description: 'This sign-in has expired.' }) });
      expect(shown).toBe('Sign-in failed. This sign-in has expired.');
    });
  });

  it('completes the MCP grant, uses up the binding and issues tokens', async () => {
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(200);
    expect(getUser).toHaveBeenCalledWith('bridge-session');
    expect(String(res.headers['set-cookie'])).toMatch(new RegExp(`gw_mcp_bridge_${reqId}=;`));
    expect(fakeRedis.getdel).toHaveBeenCalledWith(`mcp:bridgereq:${reqId}`);
    expect(grantFrom(res.body.redirect)).toMatchObject({ subject: 'auth0|bob', email: 'bob@example.test', authMode: 'lfid' });
    const back = new URL(res.body.redirect);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT_URI);
    expect(back.searchParams.get('state')).toBe('st-1');
    for (const k of ['authreq', 'bridgereq']) expect(store.has(`mcp:${k}:${reqId}`)).toBe(false);

    const tok = await request(app).post('/api/mcp-auth/token').send({
      grant_type: 'authorization_code', code: must(back.searchParams.get('code'), 'code'), code_verifier: VERIFIER,
    });
    expect(tok.status).toBe(200);

    const again = await bridgeComplete(reqId, cookie);
    expect(again.status).toBe(400);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  // The edge function checks only the return origin, so anyone can build a
  // start URL that returns to a request id. Without the cookie of the browser
  // that confirmed, the session it hands back is not accepted.
  it('refuses a completion without the cookie, leaving the request for its owner', async () => {
    const { reqId } = await startedBridge();
    for (const cookie of [null, `gw_mcp_bridge_${reqId}=nope`]) {
      const res = await bridgeComplete(reqId, cookie, 'victim-session');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('expired');
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    expect(store.has(`mcp:bridgereq:${reqId}`)).toBe(true);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('refuses and uses up a completion that skipped the confirm step', async () => {
    const { reqId, cookie } = await startBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:bridgereq:${reqId}`)).toBe(false);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
  });

  it('refuses a completion whose GETDEL lost a race, without reading the session', async () => {
    const { reqId, cookie } = await startedBridge();
    fakeRedis.getdel.mockResolvedValueOnce(null);
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('answers 401 for a session Supabase does not accept, and uses up the request', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(401);
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
  });

  it('answers 500 when completing the MCP grant fails, and uses up the request', async () => {
    ensureAuthAndPerson.mockRejectedValue(new Error('person provisioning failed'));
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(500);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
  });

  it('refuses a completion whose GETDEL returns a different value, without reading the session', async () => {
    const { reqId, cookie } = await startedBridge();
    fakeRedis.getdel.mockResolvedValueOnce(JSON.stringify({ binding: 'x', started: true }));
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it.each([['"yes"', 'yes'], ['false', false], ['1', 1]])('treats a stored started value of %s as corrupt', async (_label, started) => {
    const { reqId, cookie } = await startedBridge();
    const stored = JSON.parse(must(store.get(`mcp:bridgereq:${reqId}`), 'bridgereq')) as Record<string, unknown>;
    store.set(`mcp:bridgereq:${reqId}`, JSON.stringify({ ...stored, started }));
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it.each([['an empty', ''], ['a numeric', 42], ['an object', { t: 1 }], ['no', undefined]])(
    'refuses %s access token before touching the request',
    async (_label, token) => {
      const { reqId, cookie } = await startedBridge();
      const res = await request(app).post('/api/mcp-auth/bridge/complete').set('Cookie', cookie).send({ req_id: reqId, access_token: token });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(getUser).not.toHaveBeenCalled();
      expect(store.has(`mcp:bridgereq:${reqId}`)).toBe(true);
      expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
    },
  );

  it('answers 500 and leaves the request alone when Redis fails before the binding is claimed', async () => {
    const { reqId, cookie } = await startedBridge();
    fakeRedis.get.mockRejectedValueOnce(new Error('redis down'));
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(500);
    expect(fakeRedis.getdel).not.toHaveBeenCalled();
    expect(fakeRedis.del).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('answers 500 and uses up the request when Redis fails after the binding is claimed', async () => {
    const { reqId, cookie } = await startedBridge();
    fakeRedis.set.mockRejectedValueOnce(new Error('redis down')); // the grant code write
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(500);
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
  });

  it('shows an expired page on the old return path, for sign-ins in flight at upgrade', async () => {
    const res = await request(app).get('/api/mcp-auth/lfid-return').query({ req_id: 'legacyrequest_0123456789abcdef' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Start again from your client.');
  });

  it('revokes the bridge session after completing, and still completes when the revoke fails', async () => {
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(200);
    expect(adminSignOut).toHaveBeenCalledWith('bridge-session', 'local');

    adminSignOut.mockResolvedValueOnce({ data: null, error: { message: 'session not found' } });
    const second = await startedBridge();
    expect((await bridgeComplete(second.reqId, second.cookie)).status).toBe(200);

    adminSignOut.mockRejectedValueOnce(new Error('network down'));
    const third = await startedBridge();
    expect((await bridgeComplete(third.reqId, third.cookie)).status).toBe(200);
    expect(adminSignOut).toHaveBeenCalledTimes(3);
  });

  it('does not revoke anything when the session is not accepted', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const { reqId, cookie } = await startedBridge();
    await bridgeComplete(reqId, cookie);
    expect(adminSignOut).not.toHaveBeenCalled();
  });

  it('refuses a form post to /bridge/complete, which only the return page calls with JSON', async () => {
    const { reqId, cookie } = await startedBridge();
    const res = await request(app).post('/api/mcp-auth/bridge/complete').set('Cookie', cookie).type('form')
      .send({ req_id: reqId, access_token: 'bridge-session' });
    expect(res.status).toBe(415);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:bridgereq:${reqId}`)).toBe(true);
  });

  it('answers 401 for a session with no email, and uses up the request', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u3', email: null, user_metadata: {} } }, error: null });
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(401);
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(false);
  });

  it('ignores user metadata values that are not strings', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u4', email: 'eve@example.test', user_metadata: { lfid_sub: 42, full_name: {} } } }, error: null });
    const { reqId, cookie } = await startedBridge();
    const res = await bridgeComplete(reqId, cookie);
    expect(res.status).toBe(200);
    expect(ensureAuthAndPerson).toHaveBeenCalledWith(supabase, { email: 'eve@example.test', authUserId: 'u4', lfidSub: undefined, displayName: undefined });
    expect(grantFrom(res.body.redirect).subject).toBe('u4');
  });

  it('escapes a client-supplied client name on the confirm page', async () => {
    seedClient('<img src=x onerror=alert(1)>');
    const { res } = await startBridge();
    expect(res.text).not.toContain('<img');
  });
});

// ── DCR redirect URIs ──────────────────────────────────────────────────────

describe('DCR redirect URI check', () => {
  function register(redirectUris: unknown) {
    return request(app).post('/api/mcp-auth/register').send({ client_name: 'Probe', redirect_uris: redirectUris });
  }

  it.each([
    'https://client.example.test/cb',
    'http://localhost/cb',
    'http://localhost:1234/cb',
    'http://LOCALHOST:1234/cb',
    'http://127.0.0.1:33418/callback',
    'http://[::1]:8080/cb',
  ])('accepts %s', async (uri) => {
    const res = await register([uri]);
    expect(res.status).toBe(201);
  });

  it.each([
    'http://localhost.attacker.example/cb',
    'http://localhost:1234.attacker.example/cb',
    'http://127.0.0.1.attacker.example/cb',
    'http://localhost@attacker.example/cb',
    'http://localhostattacker.example/cb',
    'http://attacker.example/cb',
    'http://[::1].attacker.example/cb',
    'https//localhost/cb',
    'javascript:alert(1)',
    'custom-scheme://cb',
    'not a url',
  ])('refuses %s', async (uri) => {
    const res = await register([uri]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('refuses the whole registration when one URI is bad', async () => {
    const res = await register(['http://localhost:1234/cb', 'http://localhost.attacker.example/cb']);
    expect(res.status).toBe(400);
  });

  it.each([[[]], ['http://localhost/cb'], [[42]]])('refuses redirect_uris %j', async (value) => {
    const res = await register(value);
    expect(res.status).toBe(400);
  });

  it('refuses a stored registration whose redirect_uris is not a list', async () => {
    store.set(`mcp:client:${CLIENT_ID}`, JSON.stringify({ client_name: 'Odd', redirect_uris: REDIRECT_URI }));
    const res = await authorize();
    expect(res.status).toBe(400);
    expect(res.text).toBe('redirect_uri not registered for this client');
  });

  it.each([[42], [{ x: 1 }], [['a']]])('refuses a client_name of %j with a 400', async (name) => {
    const res = await request(app).post('/api/mcp-auth/register').send({ client_name: name, redirect_uris: ['http://localhost:1234/cb'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('no longer honours a URI an older registration stored under the loose check', async () => {
    store.set(`mcp:client:${CLIENT_ID}`, JSON.stringify({ client_name: 'Old', redirect_uris: ['http://localhost.attacker.example/cb'] }));
    const res = await request(app).get('/api/mcp-auth/authorize').query({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: 'http://localhost.attacker.example/cb',
      code_challenge: CHALLENGE, code_challenge_method: 'S256',
    });
    expect(res.status).toBe(400);
    expect(res.text).toBe('redirect_uri not registered for this client');
  });
});

// ── CIMD redirect URIs ─────────────────────────────────────────────────────

describe('CIMD redirect URI check', () => {
  const CIMD_ID = 'https://client.example.test/oauth/metadata.json';

  function serveMetadata(redirectUris: string[]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ client_id: CIMD_ID, client_name: 'Meta Client', redirect_uris: redirectUris }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
  }

  function authorizeCimd(redirectUri: string) {
    return request(app).get('/api/mcp-auth/authorize').query({
      response_type: 'code', client_id: CIMD_ID, redirect_uri: redirectUri,
      code_challenge: CHALLENGE, code_challenge_method: 'S256',
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['https://client.example.test/cb', 'http://127.0.0.1:33418/callback', 'http://localhost:1234/cb'])(
    'accepts a metadata document redirect URI %s',
    async (uri) => {
      serveMetadata([uri]);
      const res = await authorizeCimd(uri);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Meta Client');
    },
  );

  it('names the client by its host when the document client_name is not a string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ client_id: CIMD_ID, client_name: { evil: true }, redirect_uris: ['https://client.example.test/cb'] }),
      { status: 200 },
    )));
    const res = await authorizeCimd('https://client.example.test/cb');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<strong>client.example.test</strong> is requesting access');
  });

  it.each([
    'http://localhost.attacker.example/cb',
    'http://attacker.example/cb',
    'javascript:alert(document.domain)//',
    'custom-scheme://cb',
  ])('refuses a metadata document redirect URI %s', async (uri) => {
    serveMetadata([uri]);
    const res = await authorizeCimd(uri);
    expect(res.status).toBe(400);
    expect(res.text).toBe('redirect_uri not registered for this client');
    expect(store.size).toBe(1); // only the seeded DCR client; no request stored
  });
});

// ── Rate limits ────────────────────────────────────────────────────────────

describe('rate limits', () => {
  it('limits /authorize, the magic-link routes and the bridge routes per client IP', async () => {
    rateLimited.length = 0;
    await authorize();
    const reqId = lastAuthReqId();
    signInWithOtp.mockResolvedValue({ error: null });
    await request(app).post('/api/mcp-auth/magic/start').type('form').send({ req_id: reqId, email: 'ada@example.test' });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'bad code' } });
    await request(app).post('/api/mcp-auth/magic/verify').type('form').send({ req_id: reqId, code: '123456' });

    moduleRow = BRIDGE_MODULE;
    const { reqId: bridgeId, cookie } = await startedBridge();
    await bridgeComplete(bridgeId, cookie);

    await request(app).post('/api/mcp-auth/register').send({ redirect_uris: ['https://client.example.test/cb'] });

    expect(rateLimited).toEqual([
      'mcp-auth-authorize /api/mcp-auth/authorize',
      'mcp-auth-magic-send /api/mcp-auth/magic/start',
      'mcp-auth-magic-verify /api/mcp-auth/magic/verify',
      'mcp-auth-authorize /api/mcp-auth/authorize',
      'mcp-auth-lfid /api/mcp-auth/bridge/start',
      'mcp-auth-lfid /api/mcp-auth/bridge/complete',
      'mcp-auth-register /api/mcp-auth/register',
    ]);
  });

  it.each([
    ['mcp-auth-authorize', () => authorize()],
    ['mcp-auth-magic-send', () => request(app).post('/api/mcp-auth/magic/start').type('form').send({ req_id: 'x'.repeat(32), email: 'a@example.test' })],
    ['mcp-auth-magic-verify', () => request(app).post('/api/mcp-auth/magic/verify').type('form').send({ req_id: 'x'.repeat(32), code: '1' })],
    ['mcp-auth-lfid', () => bridgeStart('x'.repeat(32), null)],
    ['mcp-auth-lfid', () => request(app).post('/api/mcp-auth/lfid/start').type('form').send({ req_id: 'x'.repeat(32) })],
    ['mcp-auth-lfid', () => callback('x'.repeat(32), null)],
  ])('answers a page, not JSON, when %s is exhausted on a browser route', async (bucket, send) => {
    exhausted.add(bucket);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Too many sign-in attempts');
  });

  it('keeps the JSON 429 on /bridge/complete, which the return page reads', async () => {
    exhausted.add('mcp-auth-lfid');
    const res = await bridgeComplete('x'.repeat(32), null);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
  });

  it('answers /register errors as JSON; its limiter is not wrapped for the browser', async () => {
    const res = await request(app).post('/api/mcp-auth/register').send({ redirect_uris: ['http://localhost.attacker.example/cb'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });
});

// ── A request only finishes through its own login mode ─────────────────────

describe('login mode binding', () => {
  it('refuses a native request on the magic-link and bridge routes', async () => {
    moduleRow = { status: 'enabled', config: {} };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const { reqId } = await startNative();

    const magicStart = await request(app).post('/api/mcp-auth/magic/start').type('form').send({ req_id: reqId, email: 'eve@example.test' });
    expect(magicStart.status).toBe(400);
    store.set(`mcp:magicreq:${reqId}`, JSON.stringify({ email: 'eve@example.test' }));
    const magicVerify = await request(app).post('/api/mcp-auth/magic/verify').type('form').send({ req_id: reqId, code: '123456' });
    expect(magicVerify.status).toBe(400);
    const bridge = await request(app).post('/api/mcp-auth/bridge/complete').send({ req_id: reqId, access_token: 'eve-token' });
    expect(bridge.status).toBe(400);
    const bridgeStarted = await bridgeStart(reqId, null);
    expect(bridgeStarted.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('refuses a magic-link request on the bridge routes', async () => {
    await authorize();
    const reqId = lastAuthReqId();
    // Even with a binding someone planted for it, the request is not a bridge request.
    store.set(`mcp:bridgereq:${reqId}`, JSON.stringify({ binding: createHash('sha256').update('b').digest('hex'), started: true }));
    const cookie = `gw_mcp_bridge_${reqId}=b`;
    const start = await bridgeStart(reqId, cookie);
    expect(start.status).toBe(400);
    const done = await bridgeComplete(reqId, cookie);
    expect(done.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('refuses a bridge request on the native routes', async () => {
    moduleRow = BRIDGE_MODULE;
    const { reqId, cookie } = await startBridge();
    const nativeCookie = cookie.replace('gw_mcp_bridge_', 'gw_mcp_lfid_');
    const start = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', nativeCookie).type('form').send({ req_id: reqId });
    expect(start.status).toBe(400);
    const cb = await callback(reqId, nativeCookie);
    expect(cb.status).toBe(400);
    expect(startNativeLfid).not.toHaveBeenCalled();
    expect(finishNativeLfid).not.toHaveBeenCalled();
  });

  it('accepts a request stored before the mode tag on the magic-link route, never on the native or bridge routes', async () => {
    const reqId = 'legacyrequest_0123456789abcdef';
    const legacy = JSON.stringify({ clientId: CLIENT_ID, clientName: 'C', redirectUri: REDIRECT_URI, state: null, codeChallenge: CHALLENGE });
    store.set(`mcp:authreq:${reqId}`, legacy);
    store.set(`mcp:lfidreq:${reqId}`, JSON.stringify({ binding: createHash('sha256').update('b').digest('hex') }));
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const start = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', `gw_mcp_lfid_${reqId}=b`).type('form').send({ req_id: reqId });
    expect(start.status).toBe(400);
    expect(startNativeLfid).not.toHaveBeenCalled();

    // No browser binding exists for it, so the bridge cannot finish it.
    const bridge = await bridgeComplete(reqId, `gw_mcp_bridge_${reqId}=b`);
    expect(bridge.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();

    signInWithOtp.mockResolvedValue({ error: null });
    const magic = await request(app).post('/api/mcp-auth/magic/start').type('form').send({ req_id: reqId, email: 'ada@example.test' });
    expect(magic.status).toBe(200);
  });

  it('refuses an email over 254 characters on /magic/start, even one the pattern accepts', async () => {
    await authorize();
    const reqId = lastAuthReqId();
    const email = `${'a'.repeat(250)}@b.co`;
    expect(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)).toBe(true);
    const res = await request(app).post('/api/mcp-auth/magic/start').type('form').send({ req_id: reqId, email });
    expect(res.status).toBe(400);
    expect(res.text).toBe('valid email required');
  });

  it('refuses a stored request whose id is too short to be one this server made', async () => {
    store.set('mcp:authreq:short', JSON.stringify({
      clientId: CLIENT_ID, clientName: 'C', redirectUri: REDIRECT_URI, state: null, codeChallenge: CHALLENGE, loginMode: 'bridge',
    }));
    const res = await bridgeComplete('short', 'gw_mcp_bridge_short=b', 't');
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([['bridge/complete', { access_token: 't' }], ['bridge/start', {}], ['magic/start', { email: 'a@example.test' }], ['magic/verify', { code: '1' }]])(
    'refuses a malformed request id on /%s',
    async (route, body) => {
      const res = await request(app).post(`/api/mcp-auth/${route}`).send({ req_id: '../../x', ...body });
      expect(res.status).toBe(400);
    },
  );
});

describe('login pages', () => {
  it('escapes a client-supplied client name', async () => {
    seedClient('<img src=x onerror=alert(1)>');
    const magic = await authorize();
    expect(magic.text).not.toContain('<img');
    expect(magic.text).toContain('&lt;img src=x onerror=alert(1)&gt;');

    moduleRow = { status: 'enabled', config: {} };
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const { res } = await startNative();
    expect(res.text).not.toContain('<img');
  });
});
