import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();
vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
  getRequestSupabase: () => mockSupabase.client,
}));

const state = vi.hoisted(() => ({ aliased: false, admin: false }));
const isPlatformAdmin = vi.hoisted(() => vi.fn(async () => state.admin));
vi.mock('../../lib/auth/optional-caller.js', () => ({
  resolveOptionalCaller: vi.fn(async () => ({ kind: 'anon' })),
  isPlatformAdmin,
}));
vi.mock('../../lib/storage-registry.js', () => ({
  storageAliasActive: vi.fn(async () => state.aliased),
  getStorageRegistry: vi.fn(async () => null),
  aliasedBucketStore: vi.fn(async () => null),
  setStorageModuleDir: vi.fn(),
}));

const { default: app } = await import('../../server.js');

describe('avatars on a brand whose buckets live in R2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.aliased = false;
    state.admin = false;
    // A person with no email: the route stops at "No avatar found" without
    // fetching anything.
    mockSupabase.mockResult({ id: 'p1', email: null, avatar_source: null });
  });

  it('keeps today\'s behaviour when not aliased: no admin check, RLS decides', async () => {
    const res = await request(app).post('/api/avatars/sync/p1');
    expect(res.status).toBe(400);
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('refuses a non-admin when aliased, since the write runs with the service role', async () => {
    state.aliased = true;
    expect((await request(app).post('/api/avatars/sync/p1')).status).toBe(403);
    expect((await request(app).post('/api/avatars/sync-batch').send({ customerIds: ['p1'] })).status).toBe(403);
  });

  it('lets an admin through when aliased', async () => {
    state.aliased = true;
    state.admin = true;
    const res = await request(app).post('/api/avatars/sync/p1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No avatar found');
  });
});
