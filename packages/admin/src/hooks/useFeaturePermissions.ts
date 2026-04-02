/**
 * Hook for managing feature-based permissions
 * Checks if the current admin user has access to specific features
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuthContext } from '@/app/contexts/auth/context';
import { PermissionsService } from '@/lib/permissions/service';
import type { AdminFeature, AdminPermissionsMap } from '@/lib/permissions/types';

interface UseFeaturePermissionsReturn {
  permissions: AdminPermissionsMap;
  features: AdminFeature[];
  hasFeature: (feature: AdminFeature) => boolean;
  hasAnyFeature: (features: AdminFeature[]) => boolean;
  hasAllFeatures: (features: AdminFeature[]) => boolean;
  isLoading: boolean;
  isSuperAdmin: boolean;
  refetch: () => Promise<void>;
}

export function useFeaturePermissions(accountId?: string | null): UseFeaturePermissionsReturn {
  const { user, isAuthenticated, isInitialized, impersonation } = useAuthContext();
  const [permissions, setPermissions] = useState<AdminPermissionsMap>({});
  const [features, setFeatures] = useState<AdminFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // When impersonating, use the original user's role for authorization checks
  // This ensures super admins retain their access while viewing as another user
  const effectiveUserForAuth = impersonation.isImpersonating && impersonation.originalUser
    ? impersonation.originalUser
    : user;

  // Check if user is super admin (using effective user for auth)
  const isSuperAdmin = effectiveUserForAuth?.role === 'super_admin';

  // Fetch permissions from database
  const fetchPermissions = useCallback(async () => {
    if (!isInitialized) {
      // Don't fetch until auth is initialized
      return;
    }

    if (!isAuthenticated || !user) {
      // Not authenticated - no permissions
      setPermissions({});
      setFeatures([]);
      setIsLoading(false);
      return;
    }

    // Super admins have all permissions
    if (isSuperAdmin) {
      const allFeatures: AdminFeature[] = [
        'dashboard_home',
        'dashboard_people',
        'accounts',
        'users',
        'calendars',
        'events',
        'blog',
        'scrapers',
        'competitions',
        'discounts',
        'offers',
        'cohorts',
        'payments',
        'emails',
        'compliance',
        'scheduler',
        'surveys',
        'redirects',
        'newsletters',
        'slack',
        'settings',
      ];

      const allPermissions: AdminPermissionsMap = {};
      allFeatures.forEach(feature => {
        allPermissions[feature] = true;
      });

      setPermissions(allPermissions);
      setFeatures(allFeatures);
      setIsLoading(false);
      return;
    }

    // Regular admin - fetch permissions from database
    // Use the effective user for permissions lookup
    const userForPermissions = effectiveUserForAuth!;

    try {
      setIsLoading(true);

      console.log('[useFeaturePermissions] Fetching permissions for admin:', {
        adminId: userForPermissions.id,
        email: userForPermissions.email,
        role: userForPermissions.role,
        accountId,
        isImpersonating: impersonation.isImpersonating
      });

      // Use the admin profile ID to check permissions
      const adminFeatures = await PermissionsService.getAdminFeatures(
        userForPermissions.id,
        accountId || null
      );

      const permissionsMap = await PermissionsService.getPermissionsMap(
        userForPermissions.id,
        accountId || null
      );

      console.log('[useFeaturePermissions] Permissions fetched:', {
        features: adminFeatures,
        permissionsMap
      });

      setFeatures(adminFeatures);
      setPermissions(permissionsMap);
    } catch (error) {
      console.error('Error fetching feature permissions:', error);
      setPermissions({});
      setFeatures([]);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isInitialized, effectiveUserForAuth, isSuperAdmin, accountId, impersonation.isImpersonating]);

  // Fetch permissions on mount and when dependencies change
  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Check if user has a specific feature
  const hasFeature = useCallback(
    (feature: AdminFeature): boolean => {
      // Super admins have all features
      if (isSuperAdmin) return true;

      // Check permissions map
      return permissions[feature] === true;
    },
    [isSuperAdmin, permissions]
  );

  // Check if user has ANY of the specified features
  const hasAnyFeature = useCallback(
    (featuresToCheck: AdminFeature[]): boolean => {
      if (isSuperAdmin) return true;
      return featuresToCheck.some(feature => hasFeature(feature));
    },
    [isSuperAdmin, hasFeature]
  );

  // Check if user has ALL of the specified features
  const hasAllFeatures = useCallback(
    (featuresToCheck: AdminFeature[]): boolean => {
      if (isSuperAdmin) return true;
      return featuresToCheck.every(feature => hasFeature(feature));
    },
    [isSuperAdmin, hasFeature]
  );

  return {
    permissions,
    features,
    hasFeature,
    hasAnyFeature,
    hasAllFeatures,
    isLoading,
    isSuperAdmin,
    refetch: fetchPermissions,
  };
}

// Helper hook for checking a single feature
export function useHasFeature(feature: AdminFeature, accountId?: string | null): boolean {
  const { hasFeature, isLoading } = useFeaturePermissions(accountId);

  // While loading, deny access (safer default)
  if (isLoading) return false;

  return hasFeature(feature);
}

// Helper hook for checking multiple features
export function useHasAnyFeature(features: AdminFeature[], accountId?: string | null): boolean {
  const { hasAnyFeature, isLoading } = useFeaturePermissions(accountId);

  // While loading, deny access (safer default)
  if (isLoading) return false;

  return hasAnyFeature(features);
}
