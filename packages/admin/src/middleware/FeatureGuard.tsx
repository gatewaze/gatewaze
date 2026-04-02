/**
 * FeatureGuard middleware component
 * Restricts access to features based on admin permissions
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/app/contexts/auth/Provider';
import { useHasPermission } from '@/hooks/usePermissions';
import type { AdminFeature } from '@/lib/permissions/types';

interface FeatureGuardProps {
  feature?: AdminFeature | string;
  accountId?: string | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  redirectTo?: string;
  showLoading?: boolean;
}

/**
 * Guard component that checks if user has permission for a feature
 *
 * @example
 * <FeatureGuard feature="blog">
 *   <BlogEditor />
 * </FeatureGuard>
 *
 * @example With account-specific permission
 * <FeatureGuard feature="competitions" accountId={accountId}>
 *   <CompetitionsPage />
 * </FeatureGuard>
 */
export function FeatureGuard({
  feature,
  accountId,
  children,
  fallback,
  redirectTo = '/unauthorized',
  showLoading = true,
}: FeatureGuardProps) {
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permissionLoading } = useHasPermission(
    feature as AdminFeature,
    accountId
  );

  // Show loading state
  if (authLoading || permissionLoading) {
    if (!showLoading) return null;

    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // No permission - show fallback or redirect
  if (!hasPermission) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return <Navigate to={redirectTo} replace />;
  }

  // Has permission - render children
  return <>{children}</>;
}

interface RequirePermissionProps {
  feature: AdminFeature;
  accountId?: string | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditional rendering based on permission
 * Unlike FeatureGuard, this doesn't redirect - just hides content
 *
 * @example
 * <RequirePermission feature="blog">
 *   <button>Create Blog Post</button>
 * </RequirePermission>
 */
export function RequirePermission({
  feature,
  accountId,
  children,
  fallback = null,
}: RequirePermissionProps) {
  const { hasPermission, loading } = useHasPermission(feature, accountId);

  if (loading) {
    return null;
  }

  if (!hasPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface RequireAnyPermissionProps {
  features: AdminFeature[];
  accountId?: string | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditional rendering requiring ANY of the listed permissions
 *
 * @example
 * <RequireAnyPermission features={['blog', 'events']}>
 *   <button>Manage Content</button>
 * </RequireAnyPermission>
 */
export function RequireAnyPermission({
  features,
  accountId,
  children,
  fallback = null,
}: RequireAnyPermissionProps) {
  const { user } = useAuth();
  const [hasAnyPermission, setHasAnyPermission] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) {
      setHasAnyPermission(false);
      setLoading(false);
      return;
    }

    const checkPermissions = async () => {
      const { PermissionsService } = await import('@/lib/permissions/service');

      const checks = await Promise.all(
        features.map(feature =>
          PermissionsService.hasPermission(user.id, feature, accountId)
        )
      );

      setHasAnyPermission(checks.some(check => check.hasPermission));
      setLoading(false);
    };

    checkPermissions();
  }, [user?.id, features, accountId]);

  if (loading) {
    return null;
  }

  if (!hasAnyPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface RequireAllPermissionsProps {
  features: AdminFeature[];
  accountId?: string | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditional rendering requiring ALL of the listed permissions
 *
 * @example
 * <RequireAllPermissions features={['blog', 'events']}>
 *   <button>Manage All Content</button>
 * </RequireAllPermissions>
 */
export function RequireAllPermissions({
  features,
  accountId,
  children,
  fallback = null,
}: RequireAllPermissionsProps) {
  const { user } = useAuth();
  const [hasAllPermissions, setHasAllPermissions] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) {
      setHasAllPermissions(false);
      setLoading(false);
      return;
    }

    const checkPermissions = async () => {
      const { PermissionsService } = await import('@/lib/permissions/service');

      const checks = await Promise.all(
        features.map(feature =>
          PermissionsService.hasPermission(user.id, feature, accountId)
        )
      );

      setHasAllPermissions(checks.every(check => check.hasPermission));
      setLoading(false);
    };

    checkPermissions();
  }, [user?.id, features, accountId]);

  if (loading) {
    return null;
  }

  if (!hasAllPermissions) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default FeatureGuard;
