import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Mail, UserPlus } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { SupabaseAuthService } from '@/utils/supabaseAuth';
import { Input } from '@/components/ui/Form/Input';
import OnboardingWizardLayout from './OnboardingWizardLayout';

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
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

      if (result.magicLink) {
        // CI mode: magic link returned directly — skip sign-out and auto-authenticate
        // as the new admin by following the magic link
        window.location.href = result.magicLink;
      } else {
        // Production: sign out the temp setup account so the user
        // can sign in via the magic link sent to their email
        await SupabaseAuthService.signOut();
        setDone(true);
      }
    } catch {
      setError('Failed to create admin account');
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <OnboardingWizardLayout
        currentStep={1}
        hideFooter={emailConfigured !== false}
        onNext={emailConfigured === false ? () => { window.location.href = '/login'; } : undefined}
        showPrevious={false}
      >
        <div className="flex h-full flex-col items-center justify-center text-center space-y-4">
          <Mail className="h-10 w-10 text-[var(--accent-9)]" />
          <h2 className="text-lg font-semibold tracking-tight">
            Check your email
          </h2>
          <p className="text-sm text-[var(--gray-a9)]">
            We've sent a sign-in link to <strong>{adminEmail}</strong>.
            <br />
            Click the link in the email to access your new admin account.
          </p>
          <p className="text-xs text-[var(--gray-a8)]">
            The link expires in 1 hour. If you don't see the email, check your spam folder.
          </p>
        </div>
      </OnboardingWizardLayout>
    );
  }

  return (
    <OnboardingWizardLayout
      currentStep={1}
      showPrevious={false}
      onNext={() => handleSubmit()}
      nextLabel="Continue"
      nextDisabled={isSubmitting || !adminName.trim() || !adminEmail.trim()}
      nextLoading={isSubmitting}
    >
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
      </form>
    </OnboardingWizardLayout>
  );
}

export default OnboardingPage;
