// Import Dependencies
import { Navigate } from "react-router";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { useNavigation } from "@/hooks/useNavigation";
import { getFirstAvailableRoute } from "@/utils/navigationPermissions";

/**
 * Smart redirect component that redirects users to their first available route
 * based on their permissions
 */
export function RoleBasedRedirect() {
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const navigation = useNavigation();

  // Wait for permissions to load before redirecting
  if (isLoading) {
    return null;
  }

  // Get the first available route based on user's permissions
  const firstRoute = getFirstAvailableRoute(navigation, permissions, isSuperAdmin);

  // Debug logging
  console.log('[RoleBasedRedirect] Permissions:', permissions);
  console.log('[RoleBasedRedirect] isSuperAdmin:', isSuperAdmin);
  console.log('[RoleBasedRedirect] First route:', firstRoute);

  // If we found a route, redirect there
  if (firstRoute) {
    return <Navigate to={firstRoute} replace />;
  }

  // Fallback - this shouldn't happen if user has any permissions
  // Show an error or redirect to unauthorized page
  console.error('[RoleBasedRedirect] No accessible routes found for user!');
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">No Access</h1>
        <p className="text-gray-600">You don't have permission to access any pages.</p>
        <p className="text-sm text-gray-500 mt-2">Please contact your administrator.</p>
      </div>
    </div>
  );
}
