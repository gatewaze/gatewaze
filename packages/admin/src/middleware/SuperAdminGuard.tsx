// Import Dependencies
import { useOutlet } from "react-router";

// Local Imports
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { UnauthorizedPage } from "@/components/guards/FeatureGuard";

// ----------------------------------------------------------------------

/**
 * SuperAdminGuard - restricts a route subtree to super_admin users.
 *
 * For platform surfaces whose API is gated the same way, so that typing the
 * URL does not reach a page that can only render errors. Hiding the nav entry
 * alone is presentation; this is the route-level half of the same rule.
 *
 * Shows the unauthorized page rather than redirecting, so the reason is
 * visible instead of the user bouncing somewhere unexpected. The server-side
 * gate remains the real boundary; this exists so the interface tells the truth
 * about it.
 */
export default function SuperAdminGuard() {
  const outlet = useOutlet();
  const { isSuperAdmin, isLoading } = useFeaturePermissions();

  // Permissions arrive asynchronously. Rendering the denial before they load
  // would flash it at legitimate super_admins on every navigation.
  if (isLoading) return null;

  if (!isSuperAdmin) return <UnauthorizedPage />;

  return <>{outlet}</>;
}
