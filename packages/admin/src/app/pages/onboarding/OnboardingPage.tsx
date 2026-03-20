import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Mail, UserPlus } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { SupabaseAuthService } from '@/utils/supabaseAuth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Form/Input';
import PixelTrail from '@/components/shared/PixelTrail';

export function OnboardingPage() {
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function checkEmail() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.functions.invoke('admin-add-first', {
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
      const { data, error: invokeError } = await supabase.functions.invoke('admin-add-first', {
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

      // Sign out the temporary setup session without redirecting,
      // so the "check your email" confirmation screen stays visible.
      await SupabaseAuthService.signOut();

      if (result.magicLink) {
        // No email configured (local dev) — use the magic link directly
        window.location.href = result.magicLink;
      } else {
        // Email was sent — show confirmation
        setDone(true);
      }
    } catch {
      setError('Failed to create admin account');
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <PixelTrail />
    <div className="flex min-h-[100svh] items-center justify-center p-4">
      <div className="w-full max-w-[520px]">
        {done ? (
          <Card className="p-6">
            <div className="space-y-4 text-center">
              <Mail className="mx-auto h-10 w-10 text-[var(--blue-9)]" />
              <h2 className="text-lg font-semibold tracking-tight">
                Check your email
              </h2>
              <p className="text-sm text-[var(--gray-a9)]">
                We've sent a sign-in link to <strong>{adminEmail}</strong>.
                Click the link in the email to access your new admin account.
              </p>
              <p className="text-xs text-[var(--gray-a8)]">
                The link expires in 1 hour. If you don't see the email, check your spam folder.
              </p>
              <Button
                onClick={() => { window.location.href = '/login'; }}
                size="3"
                className="w-full"
              >
                Go to Login
              </Button>
            </div>
          </Card>
        ) : (
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              <h2 className="text-lg font-semibold tracking-tight">
                Add your admin account
              </h2>
            </div>
            <p className="text-sm text-[var(--gray-a9)]">
              You're signed in with a temporary setup account. Create your real
              admin account to continue. The temporary account will be removed.
            </p>

            {emailConfigured === false && (
              <div className="flex gap-3 rounded-md border border-[var(--amber-6)] bg-[var(--amber-a3)] p-3 text-sm text-[var(--amber-11)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Email delivery is not configured</p>
                  <p className="mt-1 opacity-80">
                    Set <code className="rounded bg-[var(--amber-a3)] px-1 py-0.5 text-xs">EMAIL_PROVIDER</code> in
                    your <code className="rounded bg-[var(--amber-a3)] px-1 py-0.5 text-xs">.env</code> file
                    to enable magic link emails. Without it, you'll be signed in
                    directly after account creation (local dev only).
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md bg-[var(--red-a3)] p-3 text-sm text-[var(--red-11)]">
                {error}
              </div>
            )}

            <Input
              label="Name"
              value={adminName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdminName(e.target.value)}
              placeholder="Your name"
              required
            />

            <Input
              label="Email"
              type="email"
              value={adminEmail}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdminEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              size="3"
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Admin & Sign Out'
              )}
            </Button>
          </form>
        </Card>
        )}
        <div className="mt-6 flex justify-center">
          <img src="/theme/gatewaze/gatewaze-poweredby-white.svg" alt="Powered by Gatewaze" className="h-6 opacity-50" />
        </div>
      </div>
    </div>
    </>
  );
}

export default OnboardingPage;
