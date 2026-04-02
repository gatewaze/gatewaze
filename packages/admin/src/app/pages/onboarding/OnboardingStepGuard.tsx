import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import OnboardingWizardLayout from './OnboardingWizardLayout';

/**
 * Maps the onboarding_step DB value to the route the user should be on.
 * The value represents the LAST COMPLETED step.
 */
const STEP_ROUTE: Record<string, string> = {
  admin_created:    '/onboarding/modules',
  modules_selected: '/onboarding/setup',
  modules_setup:    '/onboarding/theme',
  complete:         '/home',
};

function getTargetRoute(step: string | null, setupComplete: boolean): string {
  if (!step) {
    // No onboarding step recorded yet.
    // If platform setup is done, user should be creating their admin account.
    // If not, they need to do platform setup first.
    return setupComplete ? '/onboarding' : '/setup';
  }
  return STEP_ROUTE[step] ?? '/onboarding';
}

export default function OnboardingStepGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) {
      setReady(true);
      return;
    }
    checked.current = true;

    async function checkStep() {
      let step: string | null = null;
      let setupComplete = false;

      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('platform_settings')
          .select('key, value')
          .in('key', ['onboarding_step', 'setup_complete']);

        if (error) {
          console.warn('[OnboardingStepGuard] DB query error:', error.message);
        }

        const rows = data ?? [];
        for (const row of rows) {
          if (row.key === 'onboarding_step') step = row.value as string;
          if (row.key === 'setup_complete' && row.value === 'true') setupComplete = true;
        }
      } catch (err) {
        console.warn('[OnboardingStepGuard] Exception:', err);
      }

      const target = getTargetRoute(step, setupComplete);

      if (location.pathname !== target) {
        navigate(target, { replace: true });
      } else {
        setReady(true);
      }
    }

    checkStep();
  }, [location.pathname]);

  if (!ready) {
    return (
      <OnboardingWizardLayout currentStep={0} hideFooter hideSteps>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-9)]" />
        </div>
      </OnboardingWizardLayout>
    );
  }

  return <Outlet />;
}
