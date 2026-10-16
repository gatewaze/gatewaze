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

// renderHook's act() runs effects before result.current is read, so the
// first render is captured from inside the hook callback.
function firstRender(feature: string, accountId?: string | null) {
  const renders: Array<{ hasPermission: boolean; loading: boolean }> = [];
  renderHook(() => {
    const r = useHasPermission(feature, accountId);
    renders.push({ hasPermission: r.hasPermission, loading: r.loading });
    return r;
  });
  return renders[0];
}

describe('useHasPermission on its first render', () => {
  it('a granted feature is already granted', () => {
    expect(firstRender('newsletters')).toEqual({ hasPermission: true, loading: false });
  });

  it('an unlisted feature is already denied', () => {
    expect(firstRender('broadcasts')).toEqual({ hasPermission: false, loading: false });
  });

  it('a super admin is loading, never briefly denied by the list', () => {
    user = { id: 'profile-1', role: 'super_admin' };
    // Not in the list: the list must not answer for a super admin.
    expect(firstRender('broadcasts')).toEqual({ hasPermission: false, loading: true });
  });

  it('with no list it is loading, as before', () => {
    getHostAdminContextForProfile.mockReturnValue(null);
    expect(firstRender('newsletters')).toEqual({ hasPermission: false, loading: true });
  });
});

describe('useHasPermission with the /me feature list', () => {
  it('answers a null account from the list, with no RPC', () => {
    const { result } = renderHook(() => useHasPermission('newsletters', null));
    expect(result.current).toEqual({ hasPermission: true, loading: false });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('falls back to the RPC for an empty feature name', async () => {
    const { result } = renderHook(() => useHasPermission(''));
    await waitFor(() => expect(result.current).toEqual({ hasPermission: true, loading: false }));
    expect(hasPermission).toHaveBeenCalledWith('profile-1', '', undefined);
  });

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
    await waitFor(() => expect(result.current).toEqual({ hasPermission: true, loading: false }));
    expect(hasPermission).toHaveBeenCalledWith('profile-1', undefined, undefined);
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
