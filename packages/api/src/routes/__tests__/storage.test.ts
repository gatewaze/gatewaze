import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
  getRequestSupabase: () => mockSupabase.client,
}));

type Caller = { kind: 'anon' } | { kind: 'authenticated'; userId: string };
const auth = vi.hoisted(() => ({
  caller: { kind: 'anon' } as Caller,
  admin: false,
}));
vi.mock('../../lib/auth/optional-caller.js', () => ({
  resolveOptionalCaller: vi.fn(async () => auth.caller),
  isPlatformAdmin: vi.fn(async () => auth.admin),
}));

const storage = vi.hoisted(() => {
  const store = {
    provider: 'supabase',
    bucket: 'media',
    publicUrl: (p: string) => `https://media.example.test/${p}`,
    put: async () => ({ bytes: 1 }),
    signUpload: async (_p: string, o: { contentType: string }) => ({
      url: 'https://acct.r2.cloudflarestorage.com/b/key?X-Amz-Signature=x',
      method: 'PUT' as const,
      headers: { 'content-type': o.contentType },
    }),
    head: async () => ({ ok: false, bytes: 0, contentType: '' }),
    remove: async () => ({ failed: [] as string[] }),
    list: async () => [],
  };
  return {
    active: true,
    registryAvailable: true,
    store,
    bucketStore: async (_b: string) => store,
  };
});
vi.mock('../../lib/storage-registry.js', () => ({
  storageAliasActive: vi.fn(async () => storage.active),
  getStorageRegistry: vi.fn(async () => (storage.registryAvailable ? { bucketStore: (b: string) => storage.bucketStore(b) } : null)),
  aliasedBucketStore: vi.fn(async () => (storage.active ? storage.store : null)),
  setStorageModuleDir: vi.fn(),
}));

const { default: app } = await import('../../server.js');

const anon = () => {
  auth.caller = { kind: 'anon' };
  auth.admin = false;
};
const user = () => {
  auth.caller = { kind: 'authenticated', userId: 'u1' };
  auth.admin = false;
};
const admin = () => {
  auth.caller = { kind: 'authenticated', userId: 'a1' };
  auth.admin = true;
};

const sign = (body: Record<string, unknown>) => request(app).post('/api/storage/sign-upload').send(body);
const del = (body: Record<string, unknown>) => request(app).post('/api/storage/delete').send(body);
const upload = (bucket: string, path: string, extra: Record<string, unknown> = {}) =>
  sign({ bucket, path, contentType: 'image/png', bytes: 1000, ...extra });

describe('POST /api/storage/sign-upload', () => {
  beforeEach(() => {
    storage.active = true;
    storage.registryAvailable = true;
    storage.store.head = async () => ({ ok: false, bytes: 0, contentType: '' });
    anon();
  });

  it('answers 404 not_enabled when the brand is still on Supabase Storage', async () => {
    storage.active = false;
    const res = await upload('media', 'profiles/a.png');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_enabled' });
  });

  it('signs an upload and returns the contract shape', async () => {
    user();
    const res = await upload('media', 'profiles/u1/a.png');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: expect.stringContaining('X-Amz-Signature'),
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      bucket: 'media',
      path: 'profiles/u1/a.png',
      publicUrl: 'https://media.example.test/profiles/u1/a.png',
    });
  });

  it('asks the store for a 15 minute URL pinned to the type and size', async () => {
    user();
    const spy = vi.spyOn(storage.store, 'signUpload');
    await sign({ bucket: 'media', path: 'profiles/a.jpg', contentType: 'IMAGE/JPEG', bytes: 1234 });
    expect(spy).toHaveBeenCalledWith('profiles/a.jpg', { contentType: 'image/jpeg', bytes: 1234, expiresSeconds: 900 });
    spy.mockRestore();
  });

  describe('auth matrix', () => {
    // [who, bucket, path, upsert, expected status]
    const cases: Array<[string, () => void, string, string, boolean, number]> = [
      ['anon', anon, 'media', 'profiles/a.png', false, 401],
      ['user', user, 'media', 'profiles/a.png', false, 200],
      ['user', user, 'media', 'profiles/a.png', true, 403],
      ['admin', admin, 'media', 'profiles/a.png', true, 200],
      ['anon', anon, 'media', 'speaker-submissions/a.png', false, 200],
      ['anon', anon, 'media', 'talks/a.png', false, 200],
      ['user', user, 'media', 'speaker-submissions/a.png', false, 200],
      ['anon', anon, 'media', 'winner-images/a.png', false, 401],
      ['user', user, 'media', 'winner-images/a.png', true, 200],
      ['user', user, 'media', 'branding/logo.png', false, 403],
      ['admin', admin, 'media', 'branding/logo.png', true, 200],
      ['anon', anon, 'invite-templates', 'x/a.png', false, 401],
      ['user', user, 'invite-templates', 'x/a.png', true, 200],
      ['user', user, 'event-images', 'a.png', false, 403],
      ['admin', admin, 'event-images', 'a.png', false, 200],
      ['anon', anon, 'event-images', 'a.png', false, 401],
    ];
    for (const [who, as, bucket, path, upsert, status] of cases) {
      it(`${who} ${upsert ? 'overwrite' : 'insert'} ${bucket}/${path} -> ${status}`, async () => {
        as();
        const res = await upload(bucket, path, { upsert });
        expect(res.status).toBe(status);
      });
    }
  });

  it('picks its own key for speaker-submissions/ and ignores upsert', async () => {
    const res = await upload('media', 'speaker-submissions/My Photo.PNG', { upsert: true });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/^speaker-submissions\/[0-9a-f-]{36}-my-photo\.png$/);
    expect(res.body.publicUrl).toBe(`https://media.example.test/${res.body.path}`);
  });

  it.each(['photo-booth-feedback', 'video-masters', 'fetch-screenshots', 'fetch-artifacts'])(
    'never signs private bucket %s, even for an admin',
    async (bucket) => {
      admin();
      const res = await upload(bucket, 'a.png');
      expect(res.status).toBe(403);
    },
  );

  it('never signs a media path inside a private bucket prefix', async () => {
    admin();
    const res = await upload('media', 'video-masters/a.png', { upsert: true });
    expect(res.status).toBe(403);
  });

  it('returns 409 exists when the object is there and upsert is off', async () => {
    user();
    storage.store.head = async () => ({ ok: true, bytes: 10, contentType: 'image/png' });
    const res = await upload('media', 'profiles/a.png');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'exists' });
  });

  it('does not check for an existing object when upserting', async () => {
    admin();
    storage.store.head = async () => ({ ok: true, bytes: 10, contentType: 'image/png' });
    const res = await upload('media', 'profiles/a.png', { upsert: true });
    expect(res.status).toBe(200);
  });

  it.each([
    ['a missing bucket', { path: 'profiles/a.png', contentType: 'image/png', bytes: 1 }, 'invalid_bucket'],
    ['an uppercase bucket', { bucket: 'Media', path: 'profiles/a.png', contentType: 'image/png', bytes: 1 }, 'invalid_bucket'],
    ['a traversal path', { bucket: 'media', path: 'profiles/../branding/a.png', contentType: 'image/png', bytes: 1 }, 'invalid_path'],
    ['an absolute path', { bucket: 'media', path: '/profiles/a.png', contentType: 'image/png', bytes: 1 }, 'invalid_path'],
    ['a query in the path', { bucket: 'media', path: 'profiles/a.png?x', contentType: 'image/png', bytes: 1 }, 'invalid_path'],
    ['a non-string path', { bucket: 'media', path: ['profiles/a.png'], contentType: 'image/png', bytes: 1 }, 'invalid_path'],
    ['no bytes', { bucket: 'media', path: 'profiles/a.png', contentType: 'image/png' }, 'invalid_bytes'],
    ['fractional bytes', { bucket: 'media', path: 'profiles/a.png', contentType: 'image/png', bytes: 1.5 }, 'invalid_bytes'],
    ['string bytes', { bucket: 'media', path: 'profiles/a.png', contentType: 'image/png', bytes: '10' }, 'invalid_bytes'],
    ['a string upsert', { bucket: 'media', path: 'profiles/a.png', contentType: 'image/png', bytes: 1, upsert: 'true' }, 'invalid_upsert'],
  ])('rejects %s with 400', async (_label, body, code) => {
    user();
    const res = await sign(body as Record<string, unknown>);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
  });

  it('rejects content types outside the allowlist', async () => {
    user();
    const res = await upload('media', 'profiles/a.html', { contentType: 'text/html' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_content_type');
  });

  it('lets only admins upload SVG', async () => {
    user();
    expect((await upload('media', 'profiles/a.svg', { contentType: 'image/svg+xml' })).status).toBe(400);
    admin();
    expect((await upload('media', 'profiles/a.svg', { contentType: 'image/svg+xml' })).status).toBe(200);
  });

  it('caps sizes: 50 MB for images, 500 MB for video (admins only)', async () => {
    user();
    expect((await upload('media', 'profiles/a.png', { bytes: 50 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await upload('media', 'profiles/a.mp4', { contentType: 'video/mp4', bytes: 1000 })).status).toBe(400);
    admin();
    expect((await upload('event-images', 'a.mp4', { contentType: 'video/mp4', bytes: 400 * 1024 * 1024 })).status).toBe(200);
    expect((await upload('event-images', 'a.mp4', { contentType: 'video/mp4', bytes: 500 * 1024 * 1024 + 1 })).status).toBe(413);
  });

  it('answers 503 when the brand is aliased but the storage module cannot load', async () => {
    user();
    storage.registryAvailable = false;
    const res = await upload('media', 'profiles/a.png');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/storage/delete', () => {
  beforeEach(() => {
    storage.active = true;
    storage.registryAvailable = true;
    anon();
  });

  it('answers 404 not_enabled when the brand is still on Supabase Storage', async () => {
    storage.active = false;
    const res = await del({ bucket: 'media', paths: ['winner-images/a.png'] });
    expect(res.status).toBe(404);
  });

  it('lets an authenticated user delete in winner-images/ and returns failed[]', async () => {
    user();
    const spy = vi.spyOn(storage.store, 'remove').mockResolvedValue({ failed: ['winner-images/b.png'] });
    const res = await del({ bucket: 'media', paths: ['winner-images/a.png', 'winner-images/b.png', 'winner-images/a.png'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ failed: ['winner-images/b.png'] });
    expect(spy).toHaveBeenCalledWith(['winner-images/a.png', 'winner-images/b.png']);
    spy.mockRestore();
  });

  it('needs admin for any path in the request that needs admin', async () => {
    user();
    const res = await del({ bucket: 'media', paths: ['winner-images/a.png', 'speaker-submissions/x.png'] });
    expect(res.status).toBe(403);
    admin();
    expect((await del({ bucket: 'media', paths: ['winner-images/a.png', 'speaker-submissions/x.png'] })).status).toBe(200);
  });

  it('rejects anonymous deletes', async () => {
    const res = await del({ bucket: 'media', paths: ['speaker-submissions/x.png'] });
    expect(res.status).toBe(401);
  });

  it('never deletes in a private bucket', async () => {
    admin();
    expect((await del({ bucket: 'video-masters', paths: ['a.mp4'] })).status).toBe(403);
    expect((await del({ bucket: 'media', paths: ['fetch-artifacts/a.json'] })).status).toBe(403);
  });

  it.each([
    [{ bucket: 'media' }],
    [{ bucket: 'media', paths: [] }],
    [{ bucket: 'media', paths: 'winner-images/a.png' }],
    [{ bucket: 'media', paths: ['winner-images/../x'] }],
    [{ bucket: 'media', paths: [7] }],
    [{ bucket: 'media', paths: Array.from({ length: 101 }, (_, i) => `winner-images/${i}.png`) }],
    [{ bucket: 'bad bucket', paths: ['a.png'] }],
  ])('rejects malformed body %j with 400', async (body) => {
    admin();
    const res = await del(body as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});

// Last: it uses up this IP's allowance for the server-keyed prefixes.
describe('rate limiting', () => {
  it('limits server-keyed uploads per IP', async () => {
    storage.active = true;
    storage.registryAvailable = true;
    anon();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await upload('media', 'speaker-submissions/a.png')).status);
    expect(statuses).toContain(429);
    // Other uploads from the same IP are not counted against that limit.
    user();
    expect((await upload('media', 'profiles/a.png')).status).toBe(200);
  });
});
