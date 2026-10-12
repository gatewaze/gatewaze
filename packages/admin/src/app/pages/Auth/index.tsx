// Import Dependencies
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useState, useEffect, useMemo, useRef } from "react";

// Local Imports
import { Button, Card, Input, InputErrorMsg } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";
import { AuthFormValues, schema } from "./schema";
import { Page } from "@/components/shared/Page";
import GradientBackground from "@/components/shared/GradientBackground";
import { getHostStatus, getSupabase, isHostSession, signInUrl, type HostStatus } from "@/lib/supabase";
import { NOT_ADMIN_CACHE_MS, safeReturnTo } from "@/lib/hostSession";
import { REDIRECT_URL_KEY } from "@/constants/app";
import { ModuleSlot } from "@/components/ModuleSlot";
import { useModuleSlots } from "@/hooks/useModuleSlots";
import { signInErrorMessage } from "./signInErrors";

// ----------------------------------------------------------------------

// How many times a pending admin check is polled before the page gives up
// and offers a manual retry.
const MAX_PENDING_CHECKS = 5;

function readQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export default function SignIn() {
  // Host-session mode: the session holder owns sign-in, so this page offers
  // one button that starts its flow, and explains a signed-in non-admin.
  const hostMode = isHostSession();
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  // Bumped to ask the session holder again (a pending poll, the one not_admin
  // re-check, or the Retry button).
  const [hostCheck, setHostCheck] = useState(0);
  const pendingChecks = useRef(0);
  const notAdminRechecked = useRef(false);
  // Only a check that turns ok after an earlier answer that was not ok
  // navigates; an ok on first load leaves the page as it is, so a Provider
  // that disagrees cannot cause a reload loop.
  const sawNotOk = useRef(false);
  const hostErrorCode = hostMode ? readQueryParam("error") : null;
  const hostError = hostErrorCode ? signInErrorMessage(hostErrorCode) : null;
  const { login, errorMessage, isLoading } = useAuthContext();
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: {
      email: "",
    },
  });

  useEffect(() => {
    async function fetchLogo() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("platform_settings")
          .select("value")
          .eq("key", "logo_url")
          .single();
        const raw = data?.value?.trim();
        if (raw) {
          // LogoUploadField stores a relative path (e.g. "branding/logo.svg")
          // in platform_settings.logo_url and resolves to a public URL via
          // supabase.storage.from('media').getPublicUrl(...) at display time.
          // The login page was rendering the raw value as an <img src>, which
          // the browser resolved against /login/branding/logo.svg → SPA
          // fallback HTML → broken image. Resolve the same way the
          // admin-side reader does.
          if (/^https?:\/\//.test(raw)) {
            setLogoUrl(raw);
          } else {
            const { data: pub } = supabase.storage.from("media").getPublicUrl(raw);
            if (pub?.publicUrl) setLogoUrl(pub.publicUrl);
          }
        }
      } catch {
        // fall back to default logo
      } finally {
        setLogoLoaded(true);
      }
    }
    fetchLogo();
  }, []);

  // Pre-auth: discover enabled modules so module-contributed sign-in providers
  // (e.g. LFID) can render and, when present, replace the magic-link form. The
  // modules context is empty here (no session + installed_modules is RLS-gated),
  // so we read the public_enabled_modules RPC directly.
  const [enabledModuleIds, setEnabledModuleIds] = useState<string[]>([]);
  const [enabledFeatures, setEnabledFeatures] = useState<string[]>([]);

  useEffect(() => {
    if (!hostMode) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkAgainAfter = (ms: number) => {
      timer = setTimeout(() => {
        if (live) setHostCheck((n) => n + 1);
      }, ms);
    };
    getHostStatus()
      .then((status) => {
        if (!live) return;
        if (status.status === "ok") {
          if (sawNotOk.current) {
            window.location.assign(safeReturnTo(readQueryParam(REDIRECT_URL_KEY) ?? "/"));
            return;
          }
          setHostStatus(status);
          return;
        }
        sawNotOk.current = true;
        if (status.status === "pending") {
          pendingChecks.current += 1;
          if (pendingChecks.current > MAX_PENDING_CHECKS) {
            setHostStatus({ status: "unavailable" });
            return;
          }
          setHostStatus(status);
          checkAgainAfter(status.retryAfterMs);
          return;
        }
        if (status.status === "not_admin" && !notAdminRechecked.current) {
          // A retrying check answers 503 admin_check_pending, so not_admin
          // should be final; looking once more after the cache window is
          // defence in depth (access granted moments ago, or a 403 sent early).
          notAdminRechecked.current = true;
          checkAgainAfter(NOT_ADMIN_CACHE_MS);
        }
        setHostStatus(status);
      })
      .catch(() => {
        if (live) setHostStatus({ status: "unavailable" });
      });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [hostMode, hostCheck]);

  useEffect(() => {
    // Host-session mode hides the provider slot, so there is nothing to discover.
    if (hostMode) return;
    async function fetchProviders() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc("public_enabled_modules");
        if (Array.isArray(data)) {
          setEnabledModuleIds(data.map((m: { id: string }) => m.id));
          setEnabledFeatures(
            data.flatMap((m: { features?: string[] }) => m.features ?? []),
          );
        }
      } catch {
        // No SSO providers discoverable pre-auth — fall back to the email form.
      }
    }
    fetchProviders();
  }, [hostMode]);

  const enabledOverride = useMemo(
    () => ({ enabledModuleIds, enabledFeatures }),
    [enabledModuleIds, enabledFeatures],
  );
  // When a sign-in provider is active, it replaces the native magic-link form.
  const hasSsoProvider = useModuleSlots("sign-in:providers", enabledOverride).length > 0;

  const startHostSignIn = () => {
    window.location.assign(signInUrl(readQueryParam(REDIRECT_URL_KEY) ?? "/"));
  };

  const retryHostCheck = () => {
    pendingChecks.current = 0;
    setHostStatus(null);
    setHostCheck((n) => n + 1);
  };

  const hostSignOut = async () => {
    const { error } = await getSupabase().auth.signOut();
    if (error) {
      // The session holder's session may still be live; do not show the
      // signed-out view as if it worked.
      toast.error("Sign-out did not complete. Please try again.");
      return;
    }
    setHostStatus({ status: "signed_out" });
  };

  const onSubmit = async (data: AuthFormValues) => {
    try {
      await login({ email: data.email });
      setMagicLinkSent(true);
    } catch {
      // Error will be handled by the auth context
    }
  };

  return (
    <Page title="Login">
      <GradientBackground />
      <main className="min-h-100vh grid w-full grow grid-cols-1 place-items-center">
        <div className="w-full max-w-[26rem] p-4 sm:px-5">
          <div className="text-center">
            {logoLoaded && (
              logoUrl ? (
                <img src={logoUrl} alt="Logo" className="mx-auto h-16 mb-8 object-contain" />
              ) : (
                <img src="/theme/gatewaze/logo_black.svg" alt="Logo" className="mx-auto h-16 mb-8 object-contain" />
              )
            )}
            <div className="mt-4">
              <p className="text-black dark:text-white">
                {hostMode
                  ? "Sign in to continue"
                  : hasSsoProvider
                  ? "Sign in to continue"
                  : magicLinkSent
                    ? "Check your email for the login link"
                    : "Enter your email to receive a login link"
                }
              </p>
            </div>
          </div>
          <Card className="mt-5 rounded-lg p-5 lg:p-7">
            {hostMode ? (
              hostStatus?.status === "pending" ? (
                <p className="text-center text-sm text-black dark:text-white" role="status">
                  Checking your access…
                </p>
              ) : hostStatus?.status === "unavailable" ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-black dark:text-white" role="status">
                    Sign-in is temporarily unavailable.
                  </p>
                  <Button
                    type="button"
                    style={{ width: "100%" }}
                    color="cyan"
                    onClick={retryHostCheck}
                  >
                    Retry
                  </Button>
                </div>
              ) : hostStatus?.status === "not_admin" ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-black dark:text-white">
                    {hostStatus.email
                      ? `You are signed in as ${hostStatus.email}, which does not have admin access.`
                      : "Your account does not have admin access."}
                  </p>
                  <Button
                    type="button"
                    style={{ width: "100%" }}
                    color="gray"
                    onClick={hostSignOut}
                  >
                    Sign out
                  </Button>
                </div>
              ) : (
                <>
                  {hostError && (
                    <div className="mb-4">
                      <InputErrorMsg when={true}>{hostError}</InputErrorMsg>
                    </div>
                  )}
                  <Button
                    type="button"
                    style={{ width: "100%" }}
                    color="cyan"
                    onClick={startHostSignIn}
                  >
                    Sign in
                  </Button>
                  <div className="mt-4 text-center">
                    <p className="text-xs text-gray-500">
                      Need an admin account? Contact the administrator.
                    </p>
                  </div>
                </>
              )
            ) : hasSsoProvider ? (
              /* A sign-in provider (e.g. LFID) is enabled — it replaces the
                 native magic-link form entirely. */
              <>
                <ModuleSlot
                  name="sign-in:providers"
                  enabledOverride={enabledOverride}
                  props={{ soleProvider: true }}
                />
                {/* e.g. a signed-in non-admin: the provider-only layout has no
                    form, so the reason is shown here. */}
                {errorMessage && (
                  <div className="mt-4 text-center">
                    <InputErrorMsg when={true}>{errorMessage}</InputErrorMsg>
                  </div>
                )}
                <div className="mt-4 text-center">
                  <p className="text-xs text-gray-500">
                    Need an admin account? Contact the administrator.
                  </p>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
                <div className="space-y-4">
                  <Input
                    label="Email"
                    placeholder="Enter your admin email"
                    type="email"
                    disabled={magicLinkSent}
                    prefix={
                      <EnvelopeIcon
                        className="size-5 transition-colors duration-200"
                        strokeWidth="1"
                      />
                    }
                    {...register("email")}
                    error={errors?.email?.message}
                  />
                </div>

                <div className="mt-2">
                  <InputErrorMsg
                    when={(errorMessage && errorMessage !== "") as boolean}
                  >
                    {errorMessage}
                  </InputErrorMsg>
                </div>

                <Button
                  type="submit"
                  style={{ marginTop: "1.25rem", width: '100%' }}
                  color="cyan"
                  disabled={magicLinkSent || isLoading}
                >
                  {isLoading
                    ? "Sending..."
                    : magicLinkSent
                      ? "Magic link sent!"
                      : "Send Login Link"
                  }
                </Button>

                {magicLinkSent && (
                  <Button
                    type="button"
                    style={{ marginTop: "0.75rem", width: '100%' }}
                    color="gray"
                    onClick={() => setMagicLinkSent(false)}
                  >
                    Try Different Email
                  </Button>
                )}

                <div className="mt-4 text-center">
                  <p className="text-xs text-gray-500">
                    Need an admin account? Contact the administrator.
                  </p>
                </div>
              </form>
            )}
          </Card>
        </div>
      </main>
    </Page>
  );
}
