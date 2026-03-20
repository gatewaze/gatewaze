import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthContext } from '@/app/contexts/auth/context';
import { supabase } from '@/lib/supabase';

const SETUP_EMAIL = 'admin@setup.localhost';
const CACHE_KEY_PREFIX = 'gatewaze-onboarding-step:';

const STEP_ROUTES: Record<string, string> = {
  admin_created: '/onboarding/modules',
  modules_selected: '/onboarding/setup',
  modules_setup: '/onboarding/theme',
};

/**
 * Redirects the temp setup admin to /onboarding.
 * Redirects real admins to the correct onboarding step if onboarding is incomplete.
 * Once onboarding_step is 'complete' (or absent), passes through normally.
 */
export function OnboardingGuard() {
  const { user, isLoading } = useAuthContext();
  const location = useLocation();
  const [onboardingStep, setOnboardingStep] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isLoading || !user) return;

    // Temp setup admin always goes to /onboarding
    if (user.email === SETUP_EMAIL) {
      setChecking(false);
      return;
    }

    // Cache key scoped to user ID so a DB reset + new user doesn't hit stale cache
    const cacheKey = `${CACHE_KEY_PREFIX}${user.id}`;

    // Check cached value first
    const cached = sessionStorage.getItem(cacheKey);
    if (cached === 'complete') {
      setOnboardingStep('complete');
      setChecking(false);
      return;
    }

    // Fetch from DB
    const fetchStep = async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'onboarding_step')
          .maybeSingle();

        const step = data?.value ?? 'complete';
        sessionStorage.setItem(cacheKey, step);
        setOnboardingStep(step);
      } catch {
        // If we can't fetch, assume complete to not block the user
        setOnboardingStep('complete');
      }
      setChecking(false);
    };

    fetchStep();
  }, [user, isLoading]);

  if (isLoading || checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Temp setup admin → /onboarding (create real admin)
  if (user?.email === SETUP_EMAIL) {
    return <Navigate to="/onboarding" replace />;
  }

  // Check if onboarding is incomplete
  if (onboardingStep && onboardingStep !== 'complete') {
    const targetPath = STEP_ROUTES[onboardingStep];
    if (targetPath && location.pathname !== targetPath) {
      return <Navigate to={targetPath} replace />;
    }
  }

  return <Outlet />;
}
