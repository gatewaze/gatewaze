import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/contexts/auth/useAuth';
import { useTheme } from '@/app/contexts/theme/ThemeProvider';
import { useAppSettings } from '@/hooks/useAppSettings';
import { isBrandingEnabled, GITHUB_URL } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const { resolvedTheme } = useTheme();
  const { appName } = useAppSettings();
  const navigate = useNavigate();

  const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'supabase';

  // Redirect to setup if not configured
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/setup`, {
          headers: { apikey: ANON_KEY },
        });
        const data = await res.json();
        if (data.needsSetup) {
          navigate('/setup', { replace: true });
        }
      } catch {
        // If setup endpoint unreachable, continue to login
      }
    };
    checkSetup();
  }, [navigate]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setMessage('');

    const result = await login({ method: 'magic_link', email });
    setIsSubmitting(false);

    if (result.success) {
      setMessage(result.message ?? 'Check your email for the login link.');
    } else {
      setError(result.error ?? 'Login failed');
    }
  };

  const handleOIDC = async () => {
    setIsSubmitting(true);
    setError('');
    await login({ method: 'oidc' });
  };

  return (
    <div className="container grid min-h-[100svh] max-w-none items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[480px] sm:p-8">
        <div className="mb-4 flex items-center justify-center">
          <h1 className="text-xl font-medium">{appName}</h1>
        </div>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-lg tracking-tight">Sign in</CardTitle>
            <CardDescription>
              {authProvider === 'oidc'
                ? 'Sign in with your organization account'
                : 'Enter your email to receive a magic link'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {message && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
                {message}
              </div>
            )}

            {authProvider === 'oidc' ? (
              <Button
                className="w-full"
                onClick={handleOIDC}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Redirecting...' : 'Sign in with SSO'}
              </Button>
            ) : (
              <form onSubmit={handleMagicLink} className="grid gap-3">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="mt-2 w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending...' : 'Send Magic Link'}
                </Button>
              </form>
            )}
          </CardContent>
          {isBrandingEnabled && (
            <CardFooter className="justify-center">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex flex-col items-start gap-0.5 opacity-60 hover:opacity-100 transition-opacity">
                <span className="text-[9px] font-medium tracking-wide text-muted-foreground">Powered by</span>
                <img
                  src={resolvedTheme === 'dark'
                    ? '/gatewaze-wordmark-white.svg'
                    : '/gatewaze-wordmark-black.svg'}
                  alt="Gatewaze"
                  className="h-5"
                />
              </a>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
