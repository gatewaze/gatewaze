import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/app/contexts/auth/useAuth';

export function AdminGuard() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
