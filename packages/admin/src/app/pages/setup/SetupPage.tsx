import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

type Step = 'welcome' | 'app' | 'done';

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
  const { resolvedTheme } = useTheme();
  const [step, setStep] = useState<Step>('welcome');
  const [appName, setAppName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const finalName = appName.trim() || 'Gatewaze';
      const res = await fetch(`${SUPABASE_URL}/functions/v1/setup`, {
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
        // Auto-login via magic link redirect
        window.location.href = data.magicLink;
        return;
      }

      // Fallback if no magic link returned
      setStep('done');
    } catch {
      setError('Failed to connect to the server. Please check your configuration.');
    } finally {
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

        {step === 'welcome' && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl tracking-tight">
                Welcome to {isBrandingEnabled ? 'Gatewaze' : 'your platform'}
              </CardTitle>
              <CardDescription>
                Let's set up your community management platform. This will only take a moment.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => setStep('app')} size="lg">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'app' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg tracking-tight">Platform Name</CardTitle>
              <CardDescription>
                Choose a name for your platform. This will be displayed in the sidebar and browser title.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="appName">App Name</Label>
                <Input
                  id="appName"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="Gatewaze"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button onClick={handleSubmit} disabled={isSubmitting}>
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
            </CardFooter>
          </Card>
        )}

        {step === 'done' && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl tracking-tight">Setup Complete</CardTitle>
              <CardDescription>
                Your platform has been configured. Redirecting...
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

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

export default SetupPage;
