import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createMockSupabase } from '../../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();
vi.mock('../../supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
}));

type Mode = 'accept' | 'reject' | 'forbid' | 'throw';
const jwtMode = vi.hoisted(() => ({ mode: 'accept' as Mode }));
vi.mock('../require-jwt.js', () => ({
  requireJwt: () => async (req: Request, res: Response, next: NextFunction) => {
    if (jwtMode.mode === 'throw') throw new Error('JWT_SECRET is not set');
    if (jwtMode.mode === 'reject') {
      res.status(401).json({ error: { code: 'invalid_token' } });
      return;
    }
    if (jwtMode.mode === 'forbid') {
      res.status(403).json({ error: { code: 'forbidden' } });
      return;
    }
    req.userId = 'user-1';
    next();
  },
}));

const { resolveOptionalCaller, isPlatformAdmin } = await import('../optional-caller.js');

describe('resolveOptionalCaller', () => {
  it('is authenticated when requireJwt accepts the token', async () => {
    jwtMode.mode = 'accept';
    expect(await resolveOptionalCaller({} as Request)).toEqual({ kind: 'authenticated', userId: 'user-1' });
  });

  it.each(['reject', 'forbid', 'throw'] as const)('is anon when requireJwt would %s', async (mode) => {
    jwtMode.mode = mode;
    expect(await resolveOptionalCaller({} as Request)).toEqual({ kind: 'anon' });
  });
});

describe('isPlatformAdmin', () => {
  beforeEach(() => mockSupabase.mockResult(null));

  it.each(['super_admin', 'admin', 'editor'])('is true for an active %s (as public.is_admin())', async (role) => {
    mockSupabase.mockResult({ role, is_active: true });
    expect(await isPlatformAdmin('u')).toBe(true);
  });

  it.each([
    ['no profile', null],
    ['an inactive admin', { role: 'admin', is_active: false }],
    ['a portal manager', { role: 'portal_manager', is_active: true }],
  ])('is false for %s', async (_label, row) => {
    mockSupabase.mockResult(row);
    expect(await isPlatformAdmin('u')).toBe(false);
  });

  it('fails closed when the lookup errors', async () => {
    mockSupabase.mockError('db down');
    expect(await isPlatformAdmin('u')).toBe(false);
  });
});
