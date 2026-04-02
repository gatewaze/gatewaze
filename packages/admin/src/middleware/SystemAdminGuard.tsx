// Import Dependencies
import { Navigate, Outlet } from "react-router";

// Local Imports
import { useAccountAccess } from "@/hooks/useAccountAccess";

/**
 * Route guard that only allows system admins and regular users
 * Redirects account users to /competitions
 */
export default function SystemAdminGuard() {
  const { isAccountUser, loading } = useAccountAccess();

  // Wait for role to be determined
  if (loading) {
    return null;
  }

  // Account users cannot access these routes
  if (isAccountUser) {
    return <Navigate to="/competitions" replace />;
  }

  // Allow system admins and regular users
  return <Outlet />;
}
