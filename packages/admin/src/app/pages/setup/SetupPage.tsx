import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form/Input';
import OnboardingWizardLayout from '@/app/pages/onboarding/OnboardingWizardLayout';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

type Step = 'checking' | 'welcome' | 'app' | 'done';

function toNamespace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('checking');
  const [appName, setAppName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-setup`, {
          headers: { apikey: ANON_KEY },
        });

        if (!res.ok) {
          setStep('welcome');
          return;
        }

        const data = await res.json();

        if (data.needsSetup) {
          setStep('welcome');
        } else {
          navigate('/login', { replace: true });
        }
      } catch {
        setStep('welcome');
      }
    };

    checkSetup();
  }, [navigate]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const finalName = appName.trim() || 'Gatewaze';
      const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          appName: finalName,
          namespace: toNamespace(finalName),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Setup failed');
        setIsSubmitting(false);
        return;
      }

      if (data.status === 'already_configured') {
        setError('This instance has already been configured.');
        setIsSubmitting(false);
        return;
      }

      // Clear the setup cache so SetupGuard won't redirect back here
      sessionStorage.setItem('gatewaze-setup-complete', 'true');

      // Navigate to onboarding to create the admin account.
      // The user is already signed in as the temp setup admin,
      // so we can go directly — no magic link redirect needed.
      navigate('/onboarding', { replace: true });
    } catch {
      setError('Failed to connect to the server. Please check your configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'checking') {
    return (
      <OnboardingWizardLayout currentStep={0} hideFooter hideSteps>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--gray-a9)]" />
        </div>
      </OnboardingWizardLayout>
    );
  }

  if (step === 'welcome') {
    return (
      <OnboardingWizardLayout currentStep={0} hideFooter hideSteps>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Let's get you up and running...
          </h1>
          <p className="mt-2 text-sm text-[var(--gray-a9)]">
            Complete this simple onboarding to get your instance of Gatewaze set up.
          </p>
          <div className="mt-10">
            <Button
              onClick={() => setStep('app')}
              size="3"
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </OnboardingWizardLayout>
    );
  }

  if (step === 'done') {
    return (
      <OnboardingWizardLayout currentStep={0} hideFooter>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Setup Complete</h1>
          <p className="mt-2 text-sm text-[var(--gray-a9)]">
            Your platform has been configured. Redirecting...
          </p>
          <Loader2 className="mt-4 h-6 w-6 animate-spin text-[var(--gray-a9)]" />
        </div>
      </OnboardingWizardLayout>
    );
  }

  return (
    <OnboardingWizardLayout
      currentStep={0}
      onNext={handleSubmit}
      nextLabel="Continue"
      nextDisabled={isSubmitting}
      nextLoading={isSubmitting}
      showPrevious={false}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Platform Name</h2>
          <p className="mt-1 text-sm text-[var(--gray-a9)]">
            Choose a name for your platform. This will be displayed in the sidebar and browser title.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-[var(--red-a3)] p-3 text-sm text-[var(--red-11)]">
            {error}
          </div>
        )}

        <Input
          label="App Name"
          value={appName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAppName(e.target.value)}
          placeholder="Gatewaze"
        />
      </div>
    </OnboardingWizardLayout>
  );
}

export default SetupPage;
