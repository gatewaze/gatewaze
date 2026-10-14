import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

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
const supabase = {
  auth: { getUser },
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

// Records which routes run the native-flow rate limiter.
const rateLimited: string[] = [];
vi.mock('../../lib/rate-limiter.js', () => ({
  ipRateLimiter: (config: { bucket: string }) => (req: { path: string }, _res: unknown, next: () => void) => {
    rateLimited.push(`${config.bucket} ${req.path}`);
    next();
  },
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
  vi.clearAllMocks();
  moduleRow = null;
  rpc.mockResolvedValue({ data: 'bridge', error: null });
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

  it('keeps the bridge redirect on a bridge install', async () => {
    moduleRow = { status: 'enabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
    const res = await authorize();
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(`${loc.origin}${loc.pathname}`).toBe('https://sb.example.test/functions/v1/integrations-lfid-callback');
    expect(loc.searchParams.get('action')).toBe('start');
    expect(loc.searchParams.get('return_url')).toMatch(new RegExp(`^${API}/api/mcp-auth/lfid-return\\?req_id=`));
    expect(rpc).toHaveBeenCalledWith('lfid_sign_in_mode');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('keeps the bridge when the mode lookup fails', async () => {
    moduleRow = { status: 'enabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    const res = await authorize();
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/functions/v1/integrations-lfid-callback');
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
    expect(rateLimited).toEqual([
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
    const bridge = await request(app).post('/api/mcp-auth/lfid-complete').send({ req_id: reqId, access_token: 'eve-token' });
    expect(bridge.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(ensureAuthAndPerson).not.toHaveBeenCalled();
    expect(store.has(`mcp:authreq:${reqId}`)).toBe(true);
  });

  it('refuses a magic-link request on the bridge route', async () => {
    await authorize();
    const reqId = lastAuthReqId();
    const res = await request(app).post('/api/mcp-auth/lfid-complete').send({ req_id: reqId, access_token: 't' });
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('completes a bridge request on the bridge route, as before', async () => {
    moduleRow = { status: 'enabled', config: { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' } };
    await authorize();
    const reqId = lastAuthReqId();
    expect(JSON.parse(must(store.get(`mcp:authreq:${reqId}`), 'authreq')).loginMode).toBe('bridge');
    const res = await request(app).post('/api/mcp-auth/lfid-complete').send({ req_id: reqId, access_token: 't' });
    expect(res.status).toBe(200);
    expect(grantFrom(res.body.redirect)).toMatchObject({ subject: 'auth0|bob', authMode: 'lfid' });
  });

  it('accepts a request stored before the mode tag on the bridge route, never on the native routes', async () => {
    const reqId = 'legacyrequest_0123456789abcdef';
    const legacy = JSON.stringify({ clientId: CLIENT_ID, clientName: 'C', redirectUri: REDIRECT_URI, state: null, codeChallenge: CHALLENGE });
    store.set(`mcp:authreq:${reqId}`, legacy);
    store.set(`mcp:lfidreq:${reqId}`, JSON.stringify({ binding: createHash('sha256').update('b').digest('hex') }));
    vi.stubEnv('LFID_SIGN_IN_MODE', 'native');
    const start = await request(app).post('/api/mcp-auth/lfid/start').set('Cookie', `gw_mcp_lfid_${reqId}=b`).type('form').send({ req_id: reqId });
    expect(start.status).toBe(400);
    expect(startNativeLfid).not.toHaveBeenCalled();

    const bridge = await request(app).post('/api/mcp-auth/lfid-complete').send({ req_id: reqId, access_token: 't' });
    expect(bridge.status).toBe(200);
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
    const res = await request(app).post('/api/mcp-auth/lfid-complete').send({ req_id: 'short', access_token: 't' });
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([['lfid-complete', { access_token: 't' }], ['magic/start', { email: 'a@example.test' }], ['magic/verify', { code: '1' }]])(
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
