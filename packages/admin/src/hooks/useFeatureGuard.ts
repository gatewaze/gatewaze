import { useHasFeature } from '@/hooks/useFeaturePermissions';
import type { AdminFeature } from '@/lib/permissions/types';

/**
 * Hook variant of <FeatureGuard /> — returns whether the current user has
 * the named feature so the caller can branch its own render logic
 * (showing a fallback, a loading spinner, etc.) rather than relying on
 * <FeatureGuard /> to redirect.
 *
 * Lives in `hooks/` so that `components/guards/FeatureGuard.tsx` only
 * exports React components — required for react-refresh fast refresh.
 *
 * @example
 *   const { hasPermission, isLoading } = useFeatureGuard('events');
 *   if (isLoading) return <Loading />;
 *   if (!hasPermission) return <AccessDenied />;
 *   return <EventsList />;
 */
export function useFeatureGuard(
  feature: AdminFeature,
  accountId?: string | null,
) {
  const hasPermission = useHasFeature(feature, accountId);
  return {
    hasPermission,
    isLoading: false, // useHasFeature handles loading internally
  };
}
