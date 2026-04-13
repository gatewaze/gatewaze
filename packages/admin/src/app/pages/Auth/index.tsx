// Import Dependencies
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import { useState, useEffect } from "react";

// Local Imports
import { Button, Card, Input, InputErrorMsg } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";
import { AuthFormValues, schema } from "./schema";
import { Page } from "@/components/shared/Page";
import GradientBackground from "@/components/shared/GradientBackground";
import { getSupabase } from "@/lib/supabase";
import { ModuleSlot } from "@/components/ModuleSlot";

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
        if (data?.value && data.value.trim() !== '') {
          setLogoUrl(data.value);
        }
      } catch {
        // fall back to default logo
      } finally {
        setLogoLoaded(true);
      }
    }
    fetchLogo();
  }, []);

  const onSubmit = async (data: AuthFormValues) => {
    try {
      await login({ email: data.email });
      setMagicLinkSent(true);
    } catch (error) {
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
                {magicLinkSent
                  ? "Check your email for the login link"
                  : "Enter your email to receive a login link"
                }
              </p>
            </div>
          </div>
          <Card className="mt-5 rounded-lg p-5 lg:p-7">
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

            {/* Extension point for third-party auth providers (e.g. LFID) */}
            <ModuleSlot name="sign-in:providers" />
          </Card>

          <div className="mt-8 flex justify-center">
            <img src="/theme/gatewaze/gatewaze-poweredby-black.svg" alt="Powered by Gatewaze" className="h-10 opacity-40" />
          </div>
        </div>
      </main>
    </Page>
  );
}
