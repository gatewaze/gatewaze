import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthCallbackPage() {
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'supabase';

    if (authProvider === 'oidc') {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setError(searchParams.get('error_description') ?? 'Authentication failed');
        return;
      }

      if (code && state) {
        // The OIDC adapter handles the callback via the auth state change listener
        // The AuthProvider will detect the new session and redirect
        import('@/lib/auth/oidc').then(({ OIDCAuthAdapter }) => {
          const adapter = new OIDCAuthAdapter({
            issuerUrl: import.meta.env.VITE_OIDC_ISSUER_URL!,
            clientId: import.meta.env.VITE_OIDC_CLIENT_ID!,
            redirectUri: `${window.location.origin}/auth/callback`,
          });
          adapter.handleCallback(code, state).then((result) => {
            if (result.success) {
              navigate('/home', { replace: true });
            } else {
              setError(result.error ?? 'Authentication failed');
            }
          });
        });
      }
    } else {
      // Supabase handles the callback automatically via detectSessionInUrl
      // Just wait briefly then redirect
      const timer = setTimeout(() => navigate('/home', { replace: true }), 1000);
      return () => clearTimeout(timer);
    }
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
