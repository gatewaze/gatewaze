import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
  getRequestSupabase: () => mockSupabase.client,
}));

const { default: app } = await import('../../server.js');

// GATEWAZE_TEST_DISABLE_AUTH=1 (set in test/setup.ts) makes requireJwt()
// inject this fixed account id for every request in this suite.
const TEST_ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a1';

describe('GET /api/app-releases/latest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the recorded version/build for this account and platform', async () => {
    mockSupabase.mockResult({ latest_version: '1.4.0', latest_build: 1260 });

    const res = await request(app).get('/api/app-releases/latest?platform=ios');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: '1.4.0', build: 1260 });
  });

  it('returns null when nothing has been recorded yet for this (account, platform)', async () => {
    mockSupabase.mockResult(null);

    const res = await request(app).get('/api/app-releases/latest?platform=ios');

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('rejects a platform outside the allowlist', async () => {
    const res = await request(app).get('/api/app-releases/latest?platform=windows');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_platform');
  });

  it('rejects a missing platform query param', async () => {
    const res = await request(app).get('/api/app-releases/latest');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_platform');
  });

  it('scopes the query to the caller\'s own account, never a client-supplied one', async () => {
    mockSupabase.mockResult(null);

    // account_id is not an accepted query param at all — req.accountId
    // (resolved server-side by requireJwt()) is the only source.
    await request(app).get('/api/app-releases/latest?platform=ios&account_id=someone-elses-account');

    expect(mockSupabase.client.eq).toHaveBeenCalledWith('account_id', TEST_ACCOUNT_ID);
    expect(mockSupabase.client.eq).not.toHaveBeenCalledWith('account_id', 'someone-elses-account');
  });

  it('returns a 500 envelope on a database failure', async () => {
    mockSupabase.mockResult(null, { message: 'boom' });

    const res = await request(app).get('/api/app-releases/latest?platform=ios');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
  });
});
