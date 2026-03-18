import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/app/contexts/auth/useAuth';

const SETUP_EMAIL = 'admin@setup.localhost';

/**
 * Redirects the temp setup admin to /onboarding.
 * All other users pass through normally.
 */
export function OnboardingGuard() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user?.email === SETUP_EMAIL) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
