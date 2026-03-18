// @ts-nocheck
import { useState, useEffect } from 'react';
import { useAuthContext } from '@/app/contexts/auth/context';
import { AccountService } from '@/utils/accountService';

export interface AccountAccess {
  isAccountUser: boolean; // User belongs to at least one account
  isSuperAdmin: boolean; // User is a super admin (full access)
  isSystemAdmin: boolean; // User is admin or super_admin (not tied to accounts)
  accounts: Array<{
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
  }>;
  highestAccountRole: 'owner' | 'admin' | 'member' | 'viewer' | null;
  canEdit: boolean; // Can edit events/competitions
  canManage: boolean; // Can manage account settings
}

export function useAccountAccess(): AccountAccess & { loading: boolean } {
  const { user, impersonation } = useAuthContext();

  // When impersonating, use the original user's role for authorization checks
  // This ensures super admins retain their access while viewing as another user
  const effectiveUserForAuth = impersonation.isImpersonating && impersonation.originalUser
    ? impersonation.originalUser
    : user;

  // Initialize with user role if available to prevent flash
  const [access, setAccess] = useState<AccountAccess>(() => {
    if (!effectiveUserForAuth) {
      return {
        isAccountUser: false,
        isSuperAdmin: false,
        isSystemAdmin: false,
        accounts: [],
        highestAccountRole: null,
        canEdit: false,
        canManage: false,
      };
    }

    // Quick check for system admin - set immediately to prevent flash
    const isSuperAdmin = effectiveUserForAuth.role === 'super_admin';
    const isSystemAdmin = effectiveUserForAuth.role === 'super_admin' || effectiveUserForAuth.role === 'admin';

    if (isSystemAdmin) {
      return {
        isAccountUser: false,
        isSuperAdmin,
        isSystemAdmin,
        accounts: [],
        highestAccountRole: null,
        canEdit: true,
        canManage: true,
      };
    }

    // For non-system admins, start with safe defaults
    return {
      isAccountUser: false,
      isSuperAdmin: false,
      isSystemAdmin: false,
      accounts: [],
      highestAccountRole: null,
      canEdit: false,
      canManage: false,
    };
  });

  const [loading, setLoading] = useState(() => {
    // If user is system admin, we don't need to load anything
    if (effectiveUserForAuth?.role === 'super_admin' || effectiveUserForAuth?.role === 'admin') {
      return false;
    }
    return true;
  });

  useEffect(() => {
    const loadAccess = async () => {
      if (!effectiveUserForAuth) {
        setLoading(false);
        return;
      }

      const isSuperAdmin = effectiveUserForAuth.role === 'super_admin';
      const isSystemAdmin = effectiveUserForAuth.role === 'super_admin' || effectiveUserForAuth.role === 'admin';

      // If super admin or system admin, update state and ensure loading is false
      if (isSystemAdmin) {
        setAccess({
          isAccountUser: false,
          isSuperAdmin,
          isSystemAdmin,
          accounts: [],
          highestAccountRole: null,
          canEdit: true,
          canManage: true,
        });
        setLoading(false);
        return;
      }

      // Check if user belongs to any accounts
      try {
        const { accounts: userAccounts, error } = await AccountService.getMyAccounts();

        if (error || !userAccounts || userAccounts.length === 0) {
          // User has no account memberships - they're a regular editor
          setAccess({
            isAccountUser: false,
            isSuperAdmin: false,
            isSystemAdmin: false,
            accounts: [],
            highestAccountRole: null,
            canEdit: effectiveUserForAuth.role === 'editor',
            canManage: false,
          });
          setLoading(false);
          return;
        }

        // User belongs to accounts - determine their highest role
        // We need to get their roles for each account
        const accountsWithRoles = await Promise.all(
          userAccounts.map(async (account) => {
            const { members } = await AccountService.getAccountMembers(account.id);
            const membership = members?.find(m => m.user_email === effectiveUserForAuth.email);
            return {
              id: account.id,
              name: account.name,
              role: membership?.account_role || 'viewer' as 'owner' | 'admin' | 'member' | 'viewer',
            };
          })
        );

        // Determine highest role
        const roleHierarchy: Record<string, number> = {
          owner: 4,
          admin: 3,
          member: 2,
          viewer: 1,
        };

        const highestRole = accountsWithRoles.reduce((highest, acc) => {
          if (!highest || roleHierarchy[acc.role] > roleHierarchy[highest]) {
            return acc.role;
          }
          return highest;
        }, null as 'owner' | 'admin' | 'member' | 'viewer' | null);

        setAccess({
          isAccountUser: true,
          isSuperAdmin: false,
          isSystemAdmin: false,
          accounts: accountsWithRoles,
          highestAccountRole: highestRole,
          canEdit: highestRole === 'owner' || highestRole === 'admin' || highestRole === 'member',
          canManage: highestRole === 'owner',
        });
      } catch (error) {
        console.error('Error loading account access:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAccess();
  }, [effectiveUserForAuth]);

  return { ...access, loading };
}
