import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Form/Input';
import GradientBackground from '@/components/shared/GradientBackground';

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

  // Redirect to login if setup is not needed (instance already configured)
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-setup`, {
          headers: { apikey: ANON_KEY },
        });

        // Only trust a successful response — a 5xx may return JSON
        // without a needsSetup field, which would incorrectly redirect
        // to /login and cause a loop with SetupGuard.
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
        // Can't reach backend — show setup so user sees a useful error on submit
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

      if (data.magicLink) {
        window.location.href = data.magicLink;
        return;
      }

      setStep('done');
    } catch {
      setError('Failed to connect to the server. Please check your configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <GradientBackground />
    <div className="flex min-h-[100svh] items-center justify-center p-4">
      <div className="w-full max-w-[520px] space-y-4">
        {step === 'checking' && (
          <div className="flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--gray-a9)]" />
          </div>
        )}

        {step === 'welcome' && (
          <Card className="p-6">
            <div className="space-y-4 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome to your platform
              </h1>
              <p className="text-sm text-[var(--gray-a9)]">
                Let's set up your community management platform. This will only take a moment.
              </p>
              <Button onClick={() => setStep('app')} size="3" className="w-full">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {step === 'app' && (
          <Card className="p-6">
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

              <div>
                <Button onClick={handleSubmit} disabled={isSubmitting} size="3" className="w-full">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Complete Setup
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 'done' && (
          <Card className="p-6">
            <div className="space-y-4 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Setup Complete</h1>
              <p className="text-sm text-[var(--gray-a9)]">
                Your platform has been configured. Redirecting...
              </p>
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--gray-a9)]" />
            </div>
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

export default SetupPage;
