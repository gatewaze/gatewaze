/**
 * Hook for managing team member permissions
 * Simplifies granting/revoking permissions when managing team members
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/app/contexts/auth/Provider';
import { PermissionsService } from '@/lib/permissions/service';
import type { AdminFeature } from '@/lib/permissions/types';

interface UseTeamMemberPermissionsOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for managing team member feature permissions
 *
 * @example
 * ```tsx
 * const {
 *   syncPermissions,
 *   loading,
 *   error,
 * } = useTeamMemberPermissions({
 *   onSuccess: () => console.log('Permissions updated!'),
 * });
 *
 * // When user selects features in dialog
 * await syncPermissions(userId, selectedFeatures);
 * ```
 */
export function useTeamMemberPermissions(
  options: UseTeamMemberPermissionsOptions = {}
) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Sync permissions for a team member
   * Grants new permissions and revokes removed ones
   */
  const syncPermissions = useCallback(
    async (
      adminId: string,
      selectedFeatures: AdminFeature[],
      accountId?: string | null
    ): Promise<boolean> => {
      if (!user?.id) {
        const error = new Error('User not authenticated');
        setError(error);
        options.onError?.(error);
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // Get current permissions for this user
        const currentFeatures = await PermissionsService.getAdminFeatures(
          adminId,
          accountId
        );

        const currentSet = new Set(currentFeatures);
        const selectedSet = new Set(selectedFeatures);

        // Calculate what to grant and what to revoke
        const toGrant = selectedFeatures.filter((f) => !currentSet.has(f));
        const toRevoke = currentFeatures.filter((f) => !selectedSet.has(f));

        // Grant new permissions
        for (const feature of toGrant) {
          await PermissionsService.grantPermission(
            {
              admin_id: adminId,
              feature,
              account_id: accountId,
            },
            user.id
          );
        }

        // Revoke removed permissions
        for (const feature of toRevoke) {
          await PermissionsService.revokePermission(
            {
              admin_id: adminId,
              feature,
              account_id: accountId,
            },
            user.id
          );
        }

        options.onSuccess?.();
        return true;
      } catch (err) {
        const error = err as Error;
        setError(error);
        options.onError?.(error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, options]
  );

  /**
   * Grant all permissions to a team member
   */
  const grantAllPermissions = useCallback(
    async (adminId: string, accountId?: string | null): Promise<boolean> => {
      const allFeatures: AdminFeature[] = [
        'dashboard_home',
        'dashboard_people',
        'accounts',
        'users',
        'events',
        'blog',
        'scrapers',
        'competitions',
        'discounts',
        'offers',
        'cohorts',
        'settings',
      ];

      return syncPermissions(adminId, allFeatures, accountId);
    },
    [syncPermissions]
  );

  /**
   * Revoke all permissions from a team member
   */
  const revokeAllPermissions = useCallback(
    async (adminId: string, accountId?: string | null): Promise<boolean> => {
      return syncPermissions(adminId, [], accountId);
    },
    [syncPermissions]
  );

  /**
   * Copy permissions from one user to another
   */
  const copyPermissions = useCallback(
    async (
      fromAdminId: string,
      toAdminId: string,
      accountId?: string | null
    ): Promise<boolean> => {
      try {
        setLoading(true);
        setError(null);

        const features = await PermissionsService.getAdminFeatures(
          fromAdminId,
          accountId
        );

        return await syncPermissions(toAdminId, features, accountId);
      } catch (err) {
        const error = err as Error;
        setError(error);
        options.onError?.(error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [syncPermissions, options]
  );

  /**
   * Assign a permission group to a team member
   */
  const assignPermissionGroup = useCallback(
    async (
      adminId: string,
      groupId: string,
      accountId?: string | null
    ): Promise<boolean> => {
      if (!user?.id) {
        const error = new Error('User not authenticated');
        setError(error);
        options.onError?.(error);
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        await PermissionsService.assignGroup(
          {
            admin_id: adminId,
            group_id: groupId,
            account_id: accountId,
          },
          user.id
        );

        options.onSuccess?.();
        return true;
      } catch (err) {
        const error = err as Error;
        setError(error);
        options.onError?.(error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, options]
  );

  /**
   * Get current permissions for a team member
   */
  const getPermissions = useCallback(
    async (
      adminId: string,
      accountId?: string | null
    ): Promise<AdminFeature[]> => {
      try {
        setLoading(true);
        setError(null);

        const features = await PermissionsService.getAdminFeatures(
          adminId,
          accountId
        );

        return features;
      } catch (err) {
        const error = err as Error;
        setError(error);
        options.onError?.(error);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [options]
  );

  return {
    syncPermissions,
    grantAllPermissions,
    revokeAllPermissions,
    copyPermissions,
    assignPermissionGroup,
    getPermissions,
    loading,
    error,
  };
}

export default useTeamMemberPermissions;
