// Import Dependencies
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import { useState, useEffect, useMemo } from "react";

// Local Imports
import { Button, Card, Input, InputErrorMsg } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";
import { AuthFormValues, schema } from "./schema";
import { Page } from "@/components/shared/Page";
import GradientBackground from "@/components/shared/GradientBackground";
import { getSupabase } from "@/lib/supabase";
import { ModuleSlot } from "@/components/ModuleSlot";
import { useModuleSlots } from "@/hooks/useModuleSlots";

// ----------------------------------------------------------------------

export default function SignIn() {
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
  }, []);

  const enabledOverride = useMemo(
    () => ({ enabledModuleIds, enabledFeatures }),
    [enabledModuleIds, enabledFeatures],
  );
  // When a sign-in provider is active, it replaces the native magic-link form.
  const hasSsoProvider = useModuleSlots("sign-in:providers", enabledOverride).length > 0;

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
                {hasSsoProvider
                  ? "Sign in to continue"
                  : magicLinkSent
                    ? "Check your email for the login link"
                    : "Enter your email to receive a login link"
                }
              </p>
            </div>
          </div>
          <Card className="mt-5 rounded-lg p-5 lg:p-7">
            {hasSsoProvider ? (
              /* A sign-in provider (e.g. LFID) is enabled — it replaces the
                 native magic-link form entirely. */
              <>
                <ModuleSlot
                  name="sign-in:providers"
                  enabledOverride={enabledOverride}
                  props={{ soleProvider: true }}
                />
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
