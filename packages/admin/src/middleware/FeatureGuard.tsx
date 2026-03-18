import { Navigate } from 'react-router-dom';
import { useAuth } from '@/app/contexts/auth/useAuth';
import { isFeatureEnabled } from '@/config/modules';

interface FeatureGuardProps {
  feature?: string;
  anyFeature?: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGuard({ feature, anyFeature, children, fallback }: FeatureGuardProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Super admins can access everything that's enabled
  const isSuperAdmin = user?.role === 'super_admin';

  // Check if module/feature is enabled
  if (feature && !isFeatureEnabled(feature)) {
    return fallback ? <>{fallback}</> : <Navigate to="/home" replace />;
  }

  if (anyFeature && !anyFeature.some((f) => isFeatureEnabled(f))) {
    return fallback ? <>{fallback}</> : <Navigate to="/home" replace />;
  }

  // Super admins bypass permission checks
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  return <>{children}</>;
}

export function useFeatureGuard(feature: string): boolean {
  return isFeatureEnabled(feature);
}
