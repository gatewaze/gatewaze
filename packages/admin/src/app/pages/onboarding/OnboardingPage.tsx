import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react';
import { useAuth } from '@/app/contexts/auth/useAuth';
import { getSupabase } from '@/lib/supabase';
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
import { isBrandingEnabled, GITHUB_URL } from '@/lib/branding';
import { useTheme } from '@/app/contexts/theme/ThemeProvider';

export function OnboardingPage() {
  const { resolvedTheme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkEmail() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.functions.invoke('add-first-admin', {
          method: 'GET',
        });
        setEmailConfigured(data?.emailConfigured ?? false);
      } catch {
        setEmailConfigured(false);
      }
    }
    checkEmail();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminName.trim() || !adminEmail.trim()) return;

    setIsSubmitting(true);
    setError('');

    try {
      const supabase = getSupabase();
      const { data, error: invokeError } = await supabase.functions.invoke('add-first-admin', {
        body: { name: adminName.trim(), email: adminEmail.trim() },
      });

      if (invokeError) {
        const detail = (data as { error?: string } | null)?.error;
        setError(detail || invokeError.message);
        setIsSubmitting(false);
        return;
      }

      const result = data as { success?: boolean; error?: string; magicLink?: string };
      if (result.error) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      // Success — sign out the temp admin
      toast.success('Admin account created! Signing you out...');
      await logout();

      if (result.magicLink) {
        // Email not configured — redirect directly via magic link
        window.location.href = result.magicLink;
      } else {
        // Email sent — go to login page
        navigate(`/auth/login?email=${encodeURIComponent(adminEmail.trim())}`);
      }
    } catch {
      setError('Failed to create admin account');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container grid min-h-[100svh] max-w-none items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[520px] sm:p-8">
        {isBrandingEnabled && (
          <div className="mb-4 flex items-center justify-center">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <img
                src={resolvedTheme === 'dark'
                  ? '/gatewaze-logo-white.svg'
                  : '/gatewaze-logo-black.svg'}
                alt="Gatewaze"
                className="h-8"
              />
            </a>
          </div>
        )}

        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg tracking-tight">
                <UserPlus className="h-5 w-5" />
                Add your admin account
              </CardTitle>
              <CardDescription>
                You're signed in with a temporary setup account. Create your real
                admin account to continue. The temporary account will be removed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {emailConfigured === false && (
                <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Email delivery is not configured</p>
                    <p className="mt-1 text-amber-800 dark:text-amber-300">
                      Set <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">EMAIL_PROVIDER</code> in
                      your <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">.env</code> file
                      to enable magic link emails. Without it, you'll be signed in
                      directly after account creation (local dev only).
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="admin-name">Name</Label>
                <Input
                  id="admin-name"
                  placeholder="Your name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="you@example.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Admin & Sign Out'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {isBrandingEnabled && (
          <div className="mt-6 flex justify-center">
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
          </div>
        )}
      </div>
    </div>
  );
}

export default OnboardingPage;
