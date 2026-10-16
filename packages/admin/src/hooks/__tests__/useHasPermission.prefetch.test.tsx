import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { id: string; role: string } | null = { id: 'profile-1', role: 'admin' };
const getHostAdminContextForProfile = vi.fn();
const hasPermission = vi.fn();

vi.mock('@/app/contexts/auth/context', () => ({ useAuthContext: () => ({ user }) }));
vi.mock('@/lib/supabase', () => ({
  getHostAdminContextForProfile: (id: string) => getHostAdminContextForProfile(id),
}));
vi.mock('@/lib/permissions/service', () => ({
  PermissionsService: { hasPermission: (...args: unknown[]) => hasPermission(...args) },
}));

const { useHasPermission } = await import('../usePermissions');

beforeEach(() => {
  user = { id: 'profile-1', role: 'admin' };
  getHostAdminContextForProfile.mockReset();
  getHostAdminContextForProfile.mockReturnValue({ profile: { id: 'profile-1' }, features: ['newsletters'] });
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ hasPermission: true });
});

describe('useHasPermission with the /me feature list', () => {
  it('answers a granted feature on the first render, with no RPC', () => {
    const { result } = renderHook(() => useHasPermission('newsletters'));
    expect(result.current).toEqual({ hasPermission: true, loading: false });
    expect(getHostAdminContextForProfile).toHaveBeenCalledWith('profile-1');
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('answers a feature that is not listed as denied, with no RPC', () => {
    const { result } = renderHook(() => useHasPermission('broadcasts'));
    expect(result.current).toEqual({ hasPermission: false, loading: false });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it.each([['an account id', 'acct-1'], ['the string "null"', 'null']])(
    'with %s',
    async (_label, accountId) => {
      const { result } = renderHook(() => useHasPermission('broadcasts', accountId));
      if (accountId === 'null') {
        // 'null' means no account, as PermissionsService treats it.
        expect(result.current).toEqual({ hasPermission: false, loading: false });
        expect(hasPermission).not.toHaveBeenCalled();
      } else {
        // The list is not filtered by account, so it cannot answer.
        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(hasPermission).toHaveBeenCalledWith('profile-1', 'broadcasts', 'acct-1');
      }
    },
  );

  it('falls back to the RPC when /me sent no list (or it went stale)', async () => {
    getHostAdminContextForProfile.mockReturnValue(null);
    const { result } = renderHook(() => useHasPermission('broadcasts'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current).toEqual({ hasPermission: true, loading: false }));
    expect(hasPermission).toHaveBeenCalledWith('profile-1', 'broadcasts', undefined);
  });

  it('falls back to the RPC when no feature is named', async () => {
    const { result } = renderHook(() => useHasPermission(undefined as unknown as string));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hasPermission).toHaveBeenCalled();
  });

  it('still lets a super admin through without looking anything up', () => {
    user = { id: 'profile-1', role: 'super_admin' };
    const { result } = renderHook(() => useHasPermission('anything'));
    expect(result.current).toEqual({ hasPermission: true, loading: false });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('denies with no user', () => {
    user = null;
    const { result } = renderHook(() => useHasPermission('newsletters'));
    expect(result.current).toEqual({ hasPermission: false, loading: false });
  });
});
