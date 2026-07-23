// Import Dependencies
import { Navigate, useLocation } from "react-router";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { useNavigation } from "@/hooks/useNavigation";
import { useNavLayout } from "@/hooks/useNavLayout";
import { resolveDefaultRoute } from "@/utils/navigationPermissions";

/**
 * Rendered by a route guard when the current user lacks access to the route
 * they landed on. Rather than dead-ending at the Access Denied page, it sends
 * them to a page they *can* reach: the configured default landing when
 * accessible, otherwise their first accessible route (same resolution used by
 * {@link RoleBasedRedirect} at the index route).
 *
 * If the resolved landing is the very route we were denied — which can only
 * happen when the guard's permission source disagrees with the nav map — we
 * fall through to `/unauthorized` instead of navigating, so a mismatch can
 * never produce a redirect loop. `/unauthorized` has no feature guard, so it
 * always renders.
 */
export function AccessDeniedRedirect() {
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const navigation = useNavigation();
  const { layout, ready: layoutReady } = useNavLayout();
  const { pathname } = useLocation();

  // Wait for permissions and the nav layout before deciding where to send them.
  if (isLoading || !layoutReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  const landing = resolveDefaultRoute(
    navigation,
    permissions,
    isSuperAdmin,
    layout?.defaultRoute,
  );

  // Redirect to an accessible page — unless that page is the one we were just
  // denied (loop guard) or the user can access nothing at all.
  if (landing && landing !== pathname) {
    return <Navigate to={landing} replace />;
  }

  return <Navigate to="/unauthorized" replace />;
}
