// A Supabase project on the newer sb_publishable_ key: requests forwarded as
// anon carry it in apikey only, never as a bearer token (it is not a JWT).
// Session requests still get the user's access token.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call } from './helpers/fakes.js';
import { type Harness, SITE, startHarness } from './helpers/harness.js';

const PUB = 'sb_publishable_test_0123456789';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ cfg: { anonKey: PUB } });
  h.supabase.addUser('u-admin', 'admin@example.test', true);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
});

const upstream = (path: string) => h.supabase.requests.filter((r) => r.url === path);

describe('publishable anon key', () => {
  it('forwards a request without a session with apikey only', async () => {
    const r = await call(h.base, 'GET', '/rest/v1/platform_settings', { apikey: PUB });
    expect(r.status).toBe(200);
    const [sent] = upstream('/rest/v1/platform_settings');
    expect(sent.headers.apikey).toBe(PUB);
    expect(sent.headers.authorization).toBeUndefined();
    expect(r.headers['cache-control']).toBeUndefined();
  });

  it('forwards a cross-site GET as anon with apikey only', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/storage/v1/object/public/b/k.png', { cookie: s.cookie, origin: 'https://evil.example' });
    expect(r.status).toBe(200);
    const [sent] = upstream('/storage/v1/object/public/b/k.png');
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers.apikey).toBe(PUB);
  });

  it('still attaches the session token for a signed-in admin, and marks the response private', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, origin: SITE, apikey: PUB });
    expect(r.status).toBe(200);
    const [sent] = upstream('/rest/v1/notes');
    expect(sent.headers.authorization).toBe(`Bearer ${s.session.access_token}`);
    expect(sent.headers.apikey).toBe(PUB);
    expect(r.headers['cache-control']).toMatch(/^private/);
  });

  it('sends nothing to the Gatewaze API without a session', async () => {
    const r = await call(h.base, 'GET', '/api/health', {});
    expect(r.status).toBe(200);
    const [sent] = h.api.requests;
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers.apikey).toBeUndefined();
  });
});
