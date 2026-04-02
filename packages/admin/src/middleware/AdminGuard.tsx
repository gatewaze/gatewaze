// Import Dependencies
import { Navigate, useOutlet } from "react-router";

// Local Imports
import { useAccountAccess } from "@/hooks/useAccountAccess";

// ----------------------------------------------------------------------

/**
 * AdminGuard - Prevents account users from accessing system admin routes
 * Account users should only access /competitions and /members
 */
export default function AdminGuard() {
  const outlet = useOutlet();
  const { isAccountUser, isSystemAdmin } = useAccountAccess();

  // If user is an account user (not a system admin), redirect to competitions
  if (isAccountUser && !isSystemAdmin) {
    return <Navigate to="/competitions" replace />;
  }

  return <>{outlet}</>;
}
