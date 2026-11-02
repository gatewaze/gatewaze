import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const reg = vi.hoisted(() => ({
  store: null as null | { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> },
  error: null as Error | null,
}));
vi.mock('../storage-registry.js', () => ({
  aliasedBucketStore: vi.fn(async () => {
    if (reg.error) throw reg.error;
    return reg.store;
  }),
}));

const { uploadToBucket, removeFromBucket } = await import('../storage-write.js');

function legacyClient() {
  const bucket = {
    upload: vi.fn(async () => ({ data: { path: 'p' }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const client = { storage: { from: vi.fn(() => bucket) } } as unknown as SupabaseClient;
  return { client, bucket, from: (client as unknown as { storage: { from: ReturnType<typeof vi.fn> } }).storage.from };
}

beforeEach(() => {
  reg.store = null;
  reg.error = null;
});

describe('uploadToBucket', () => {
  it('uses supabase.storage exactly as before when the brand is not aliased', async () => {
    const legacy = legacyClient();
    const body = Buffer.from('x');
    const res = await uploadToBucket(legacy.client, 'media', 'customers/a.png', body, { contentType: 'image/png', cacheControl: '3600', upsert: false });
    expect(res).toEqual({ error: null });
    expect(legacy.from).toHaveBeenCalledWith('media');
    expect(legacy.bucket.upload).toHaveBeenCalledWith('customers/a.png', body, { contentType: 'image/png', cacheControl: '3600', upsert: false });
  });

  it('passes a Supabase upload error through', async () => {
    const legacy = legacyClient();
    legacy.bucket.upload.mockResolvedValueOnce({ data: null, error: { message: 'denied by RLS' } } as never);
    const res = await uploadToBucket(legacy.client, 'media', 'a.png', Buffer.from('x'), { contentType: 'image/png' });
    expect(res.error?.message).toBe('denied by RLS');
  });

  it('writes through the aliased store, not Supabase, when aliased', async () => {
    const legacy = legacyClient();
    reg.store = { put: vi.fn(async () => ({ bytes: 1 })), remove: vi.fn() };
    const body = Buffer.from('x');
    const res = await uploadToBucket(legacy.client, 'media', 'event-previews/e1.jpg', body, { contentType: 'image/jpeg', cacheControl: '3600', upsert: true });
    expect(res).toEqual({ error: null });
    expect(reg.store.put).toHaveBeenCalledWith('event-previews/e1.jpg', body, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: 'public, max-age=3600',
    });
    expect(legacy.bucket.upload).not.toHaveBeenCalled();
  });

  it('reports an aliased write failure and does not fall back to Supabase', async () => {
    const legacy = legacyClient();
    reg.store = { put: vi.fn(async () => { throw new Error('r2 down'); }), remove: vi.fn() };
    const res = await uploadToBucket(legacy.client, 'media', 'a.png', Buffer.from('x'), { contentType: 'image/png' });
    expect(res.error?.message).toBe('r2 down');
    expect(legacy.bucket.upload).not.toHaveBeenCalled();
  });

  it('reports a missing storage module on an aliased brand', async () => {
    const legacy = legacyClient();
    reg.error = new Error('storage module cannot be loaded');
    const res = await uploadToBucket(legacy.client, 'media', 'a.png', Buffer.from('x'), { contentType: 'image/png' });
    expect(res.error?.message).toMatch(/cannot be loaded/);
    expect(legacy.bucket.upload).not.toHaveBeenCalled();
  });
});

describe('removeFromBucket', () => {
  it('uses supabase.storage when not aliased', async () => {
    const legacy = legacyClient();
    expect(await removeFromBucket(legacy.client, 'media', ['a.png'])).toEqual({ error: null });
    expect(legacy.bucket.remove).toHaveBeenCalledWith(['a.png']);
  });

  it('uses the aliased store when aliased and reports failures', async () => {
    const legacy = legacyClient();
    reg.store = { put: vi.fn(), remove: vi.fn(async () => ({ failed: ['a.png'] })) };
    const res = await removeFromBucket(legacy.client, 'media', ['a.png']);
    expect(res.error).not.toBeNull();
    expect(legacy.bucket.remove).not.toHaveBeenCalled();
  });
});
