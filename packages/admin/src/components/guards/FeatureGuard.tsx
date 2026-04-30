/**
 * Feature Guard Component
 * Protects routes and components based on admin feature permissions
 */

import { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import type { AdminFeature } from '@/lib/permissions/types';

interface FeatureGuardProps {
  /**
   * Single feature required to access this component/route
   */
  feature?: AdminFeature;

  /**
   * Multiple features - user needs ANY of these to access
   */
  anyFeature?: AdminFeature[];

  /**
   * Where to redirect if permission denied
   */
  redirectTo?: string;

  /**
   * Custom fallback component to show instead of redirecting
   */
  fallback?: ReactNode;

  /**
   * Account ID context (optional)
   */
  accountId?: string | null;

  /**
   * Children to render if permission granted
   */
  children: ReactNode;
}

/**
 * FeatureGuard component
 * Wraps content that should only be visible to users with specific permissions
 *
 * Usage:
 * ```tsx
 * <FeatureGuard feature="events">
 *   <EventsPage />
 * </FeatureGuard>
 * ```
 *
 * Or for multiple features:
 * ```tsx
 * <FeatureGuard anyFeature={['competitions', 'discounts']}>
 *   <DashboardPage />
 * </FeatureGuard>
 * ```
 */
export function FeatureGuard({
  feature,
  anyFeature,
  redirectTo = '/unauthorized',
  fallback,
  accountId,
  children,
}: FeatureGuardProps) {
  const { hasFeature, hasAnyFeature, isLoading } = useFeaturePermissions(accountId);

  // While loading permissions, show a loading state instead of denying access
  // This prevents the misleading "Access Denied" screen when returning to the app after idle
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  // Determine if user has required permission
  const hasPermission = feature
    ? hasFeature(feature)
    : anyFeature
    ? hasAnyFeature(anyFeature)
    : true; // No features specified = allow by default

  // Permission denied
  if (!hasPermission) {
    // Show custom fallback if provided
    if (fallback) {
      return <>{fallback}</>;
    }

    // Otherwise redirect
    return <Navigate to={redirectTo} replace />;
  }

  // Permission granted - render children
  return <>{children}</>;
}

// `useFeatureGuard` moved to `@/hooks/useFeatureGuard` so this file only
// exports components — required for react-refresh fast refresh.

/**
 * Unauthorized page component
 * Shows when user tries to access a route they don't have permission for
 */
export function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
      <div className="mx-auto max-w-md space-y-6 p-8 text-center">
        <div className="inline-flex size-20 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
          <svg
            className="size-10 text-red-600 dark:text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-12)]">
            Access Denied
          </h1>
          <p className="mt-2 text-[var(--gray-11)]">
            You don't have permission to access this page.
          </p>
          <p className="mt-1 text-sm text-[var(--gray-11)]">
            Please contact your administrator if you believe this is an error.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-300 dark:focus:ring-primary-800"
          >
            Go to Home
          </a>
          <a
            href="/settings/general"
            className="inline-flex items-center justify-center rounded-lg border border-[var(--gray-a5)] bg-[var(--gray-2)] px-5 py-2.5 text-sm font-medium text-[var(--gray-11)] hover:bg-[var(--gray-3)] focus:outline-none focus:ring-4 focus:ring-[var(--gray-a3)]"
          >
            View Profile
          </a>
        </div>
      </div>
    </div>
  );
}
