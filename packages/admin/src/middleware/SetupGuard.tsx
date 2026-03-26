import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CACHE_KEY = 'gatewaze-setup-complete';

export function SetupGuard() {
  const cached = sessionStorage.getItem(CACHE_KEY) === 'true';
  const [status, setStatus] = useState<'loading' | 'needs_setup' | 'ready'>(
    cached ? 'ready' : 'loading',
  );

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-setup`, {
          headers: { apikey: ANON_KEY },
        });

        // Treat server errors (5xx) as transient — don't redirect to setup
        if (res.status >= 500) {
          console.warn(`[SetupGuard] platform-setup returned ${res.status}, treating as ready`);
          setStatus('ready');
          return;
        }

        const data = await res.json();

        if (data.needsSetup) {
          sessionStorage.removeItem(CACHE_KEY);
          setStatus('needs_setup');
        } else {
          sessionStorage.setItem(CACHE_KEY, 'true');
          setStatus('ready');
        }
      } catch {
        // Network failure — if we previously completed setup, stay ready
        if (cached) {
          setStatus('ready');
        } else {
          sessionStorage.removeItem(CACHE_KEY);
          setStatus('needs_setup');
        }
      }
    };

    checkSetup();
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (status === 'needs_setup') {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}
